/**
 * Stage 4 — reply quality repair orchestration (reuses single recovery writer).
 */

import type { PublicFactEvidence } from "@/lib/agent/public-fact-evidence";
import { buildPublicFactEvidencePromptBlock } from "@/lib/agent/public-fact-evidence";
import type { Stage12ResponseMode } from "@/lib/agent/response-mode";
import {
  isHardBlockReasonCode,
} from "@/lib/agent/reply-guarantee-policy";
import {
  runFennReplyRecovery,
  type ReplyRecoveryModelCaller,
} from "@/lib/agent/reply-recovery";
import { sanitizeReplyCandidate } from "@/lib/agent/reply-recovery-schema";
import {
  chooseReplyAfterQuality,
  detectSpeechQualityViolations,
  evaluateWallBodySpeechQuality,
  shouldTriggerQualityRecovery,
  type SpeechQualityViolation,
} from "@/lib/agent/speech-quality-gate";

export type QualityEnsureResult = {
  replyText: string | null;
  /** Total recovery model calls used in this ensure path (0 or 1). */
  recoveryCalls: 0 | 1;
  replyRecovery: "not_needed" | "succeeded" | "failed" | "skipped" | "quality_repaired";
  qualityViolations: SpeechQualityViolation[];
  /** Wall body after quality check (null when suppressed). */
  wallBody: string | null;
  wallSuppressed: boolean;
  wallSuppressReasons: string[];
  error?: string;
};

/**
 * Ensure usable X replyText with at most one recovery call total for:
 * - missing text
 * - strong quality violations
 *
 * Wall body quality failures suppress Wall only.
 */
export async function ensureReplyWithQualityGate(input: {
  action: string;
  reasonCode?: string | null;
  replyText: string | null;
  wallBody: string | null;
  xPostId: string;
  perceptionType: string;
  authorXUserId: string;
  authorUsername: string | null;
  body: string;
  knowledgeBoundaryNote?: string | null;
  trustedFacts?: readonly PublicFactEvidence[] | null;
  responseMode?: Stage12ResponseMode | null;
  callModel?: ReplyRecoveryModelCaller;
}): Promise<QualityEnsureResult> {
  const facts = input.trustedFacts ?? [];
  const factBlock =
    facts.length > 0 ? buildPublicFactEvidencePromptBlock(facts) : null;

  const empty: QualityEnsureResult = {
    replyText: null,
    recoveryCalls: 0,
    replyRecovery: "skipped",
    qualityViolations: [],
    wallBody: input.wallBody,
    wallSuppressed: false,
    wallSuppressReasons: [],
  };

  if (isHardBlockReasonCode(input.reasonCode)) {
    return {
      ...empty,
      replyText: sanitizeReplyCandidate(input.replyText),
      replyRecovery: "skipped",
    };
  }

  if (
    input.action !== "reply_on_x" &&
    input.action !== "reply_and_write_to_wall"
  ) {
    return {
      ...empty,
      replyText: sanitizeReplyCandidate(input.replyText),
      replyRecovery: "skipped",
    };
  }

  let reply = sanitizeReplyCandidate(input.replyText);
  let recoveryCalls: 0 | 1 = 0;
  let replyRecovery: QualityEnsureResult["replyRecovery"] = "not_needed";
  let qualityViolations: SpeechQualityViolation[] = [];

  const policyOutcome =
    input.action === "reply_and_write_to_wall" ||
    (input.wallBody != null && input.wallBody.trim().length > 0)
      ? "wall_and_reply"
      : "reply_only";

  async function recoverOnce(
    reasonNotes: string[],
    pre: string | null,
  ): Promise<string | null> {
    const recovered = await runFennReplyRecovery({
      xPostId: input.xPostId,
      perceptionType: input.perceptionType,
      authorXUserId: input.authorXUserId,
      authorUsername: input.authorUsername,
      body: input.body,
      policyOutcome,
      wallBody: input.wallBody,
      knowledgeBoundaryNote: input.knowledgeBoundaryNote ?? null,
      publicFactEvidenceBlock: factBlock,
      responseMode: input.responseMode ?? null,
      violationLabels: reasonNotes,
      priorDraft: pre,
      callModel: input.callModel,
    });
    if (!recovered.ok) return null;
    return sanitizeReplyCandidate(recovered.replyText);
  }

  // Missing reply → one recovery
  if (!reply) {
    const recovered = await recoverOnce(
      ["missing_reply_text"],
      input.replyText,
    );
    recoveryCalls = 1;
    if (!recovered) {
      return {
        replyText: null,
        recoveryCalls: 1,
        replyRecovery: "failed",
        qualityViolations: [],
        wallBody: input.wallBody,
        wallSuppressed: false,
        wallSuppressReasons: [],
        error: "reply recovery failed",
      };
    }
    reply = chooseReplyAfterQuality(null, recovered, facts);
    replyRecovery = "succeeded";
    if (!reply) {
      return {
        replyText: null,
        recoveryCalls: 1,
        replyRecovery: "failed",
        qualityViolations: [],
        wallBody: input.wallBody,
        wallSuppressed: false,
        wallSuppressReasons: [],
        error: "recovered reply unusable after fact checks",
      };
    }
  }

  // Quality gate on current draft
  qualityViolations = detectSpeechQualityViolations(reply, "reply");
  if (
    shouldTriggerQualityRecovery(qualityViolations) &&
    recoveryCalls === 0
  ) {
    const pre = reply;
    const recovered = await recoverOnce(
      qualityViolations.map(String),
      pre,
    );
    recoveryCalls = 1;
    if (recovered) {
      const chosen = chooseReplyAfterQuality(pre, recovered, facts);
      if (chosen) {
        reply = chosen;
        replyRecovery = "quality_repaired";
        qualityViolations = detectSpeechQualityViolations(reply, "reply");
        // No second model loop even if violations remain
      }
    } else {
      // Keep factual pre draft rather than fail
      const chosen = chooseReplyAfterQuality(pre, null, facts);
      reply = chosen ?? pre;
      replyRecovery = "not_needed";
    }
  } else if (qualityViolations.length > 0 && recoveryCalls === 1) {
    // Already used recovery (missing or quality) — conservative cleanup only
    const chosen = chooseReplyAfterQuality(reply, reply, facts);
    if (chosen) reply = chosen;
  }

  // Wall body quality — suppress only
  let wallBody = input.wallBody;
  let wallSuppressed = false;
  let wallSuppressReasons: string[] = [];
  if (wallBody && wallBody.trim().length > 0) {
    const wallQ = evaluateWallBodySpeechQuality({
      wallBody,
      trustedFacts: facts,
    });
    if (!wallQ.ok) {
      wallSuppressed = true;
      wallSuppressReasons = wallQ.reasons;
      wallBody = null;
    }
  }

  return {
    replyText: reply,
    recoveryCalls,
    replyRecovery,
    qualityViolations,
    wallBody,
    wallSuppressed,
    wallSuppressReasons,
  };
}
