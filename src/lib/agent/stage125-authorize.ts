import "server-only";

import {
  STAGE125_AUTHORITY_BATCH_DEFAULT,
  STAGE125_AUTHORITY_BATCH_MAX,
} from "@/lib/agent/authority-config";
import {
  claimXPerceptionForAuthority,
  inspectAuthorizationByXPostId,
  persistXPerceptionAuthorization,
  type ClaimedAuthorityJudgement,
} from "@/lib/agent/authority-persist";
import { evaluateAuthorityDecision } from "@/lib/agent/authority-policy";
import {
  applyReplyGuaranteePolicy,
  isHardBlockReasonCode,
} from "@/lib/agent/reply-guarantee-policy";
import type { ReplyRecoveryModelCaller } from "@/lib/agent/reply-recovery";
import { evaluateChroniclerWallAdmission } from "@/lib/agent/chronicler-evaluate";
import { loadTrustedFactsForChronicler } from "@/lib/agent/chronicler-load-facts";
import {
  attachAuthorizationToWallFactMemory,
  isWallFactFingerprintRemembered,
  tryReserveWallFactMemory,
} from "@/lib/agent/chronicler-memory";
import { inferResponseModeFromBody } from "@/lib/agent/response-mode";
import type { WallCandidate } from "@/lib/agent/chronicler-types";
import { ensureReplyWithQualityGate } from "@/lib/agent/speech-quality";

type AdminLike = {
  from: (table: string) => unknown;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type AuthorizeOneResult = {
  status:
    | "authorised"
    | "already_authorised"
    | "empty"
    | "failed"
    | "reply_generation_failed";
  xPostId?: string;
  perceptionEventId?: string;
  judgementId?: string;
  finalAction?: string;
  outcome?: string;
  policyCode?: string;
  /** reply_only | wall_and_reply | blocked | reply_generation_failed … */
  policyOutcome?: string;
  effectsCreated?: number;
  /** Observability: whether focused recovery ran. */
  replyRecovery?:
    | "not_needed"
    | "succeeded"
    | "failed"
    | "skipped"
    | "quality_repaired";
  recoveryCalls?: number;
  /** Stage 4 quality / Wall suppress diagnostics */
  speechQuality?: {
    violations: string[];
    wallSuppressed: boolean;
    wallSuppressReasons: string[];
  };
  /** Stage 3 Chronicler observability */
  chronicler?: {
    decision: string;
    code: string;
    kind: string | null;
    factKey: string | null;
    factFingerprint: string | null;
    admitted: boolean;
    alreadyRemembered: boolean;
  };
  error?: string;
};

export type AuthorizeBatchAggregate = {
  scanned: number;
  authorised: number;
  alreadyAuthorised: number;
  failed: number;
  replyGenerationFailed: number;
  results: AuthorizeOneResult[];
};

type Stage125Deps = {
  admin?: AdminLike;
  callReplyRecovery?: ReplyRecoveryModelCaller;
  /** Test override: trust facts without DB. */
  loadTrustedFacts?: typeof loadTrustedFactsForChronicler;
  isRemembered?: typeof isWallFactFingerprintRemembered;
  tryReserve?: typeof tryReserveWallFactMemory;
};

function clampBatchLimit(limit: number | undefined): number {
  const n = Math.floor(limit ?? STAGE125_AUTHORITY_BATCH_DEFAULT);
  if (!Number.isFinite(n) || n < 1) return STAGE125_AUTHORITY_BATCH_DEFAULT;
  return Math.min(n, STAGE125_AUTHORITY_BATCH_MAX);
}

/**
 * Claim one finalized judgement, recover reply if needed, Chronicler admit,
 * evaluate policy, persist authority + pending effects. Does not execute.
 *
 * Ordering for public_fact Walls:
 * 1) pure Chronicler evaluate (with remembered lookup)
 * 2) tryReserve fingerprint (unique constraint = final race gate)
 * 3) pure evaluateAuthorityDecision plans effects
 * 4) persist auth+effects
 * 5) optional attach authorization_id to memory
 *
 * Rejection of Wall never blocks reply; never wall-only.
 */
export async function authorizeOneXPerception(
  deps: Stage125Deps = {},
): Promise<AuthorizeOneResult> {
  let claimed: ClaimedAuthorityJudgement | null;
  try {
    claimed = await claimXPerceptionForAuthority({ admin: deps.admin });
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "claim failed",
    };
  }

  if (!claimed) return { status: "empty" };

  if (claimed.alreadyAuthorised) {
    const existing = await inspectAuthorizationByXPostId(claimed.xPostId, {
      admin: deps.admin,
    });
    return {
      status: "already_authorised",
      xPostId: claimed.xPostId,
      perceptionEventId: claimed.perceptionEventId,
      judgementId: claimed.judgementId,
      finalAction: existing?.finalAction ?? claimed.finalAction ?? undefined,
      outcome: existing?.outcome,
      policyCode: existing?.policyCode,
      policyOutcome:
        existing?.outcome === "permitted"
          ? existing.effects.some((e) => e.effectType === "write_to_wall")
            ? "wall_and_reply"
            : existing.effects.some((e) => e.effectType === "reply_on_x")
              ? "reply_only"
              : "blocked"
          : "blocked",
      effectsCreated: existing?.effects.length ?? 0,
      replyRecovery: "not_needed",
      recoveryCalls: 0,
    };
  }

  try {
    const guaranteed = applyReplyGuaranteePolicy({
      engage:
        claimed.finalAction !== "do_nothing" &&
        !isHardBlockReasonCode(claimed.finalReasonCode),
      action: claimed.finalAction ?? "do_nothing",
      reasonCode: claimed.finalReasonCode ?? "insufficient_knowledge",
      replyText: claimed.finalReplyText,
      wallBody: claimed.finalWallBody,
      allowDeferredLiveSilence: false,
    });

    let finalAction = guaranteed.action;
    let finalReplyText = guaranteed.replyText;
    let finalWallBody = guaranteed.wallBody;
    let finalReasonCode = guaranteed.reasonCode;
    let replyRecovery: AuthorizeOneResult["replyRecovery"] = "not_needed";
    let recoveryCalls = 0;
    let speechQuality: AuthorizeOneResult["speechQuality"];

    // Stage 4: load facts first so recovery + quality gate share Stage 2 evidence.
    const responseMode = inferResponseModeFromBody(claimed.body);
    const loadFacts = deps.loadTrustedFacts ?? loadTrustedFactsForChronicler;
    const trustedFacts = await loadFacts({
      body: claimed.body,
      needsLiveState: claimed.needsLiveState,
      wallCandidate: claimed.finalWallCandidate,
    });

    if (
      finalAction === "reply_on_x" ||
      finalAction === "reply_and_write_to_wall"
    ) {
      const knowledgeBoundary =
        !claimed.liveStateAvailable && claimed.needsLiveState.length > 0
          ? "Trusted live state was unavailable. Answer honestly that you cannot establish the current figure; do not invent numbers."
          : "Answer only from public knowledge implied by the mention. Do not invent private Outlaw facts or live balances.";

      const quality = await ensureReplyWithQualityGate({
        action: finalAction,
        reasonCode: finalReasonCode,
        replyText: finalReplyText,
        wallBody: finalWallBody,
        xPostId: claimed.xPostId,
        perceptionType: claimed.perceptionType,
        authorXUserId: claimed.authorXUserId,
        authorUsername: null,
        body: claimed.body,
        knowledgeBoundaryNote: knowledgeBoundary,
        trustedFacts,
        responseMode,
        callModel: deps.callReplyRecovery,
      });

      recoveryCalls = quality.recoveryCalls;
      speechQuality = {
        violations: quality.qualityViolations,
        wallSuppressed: quality.wallSuppressed,
        wallSuppressReasons: quality.wallSuppressReasons,
      };

      if (quality.replyRecovery === "failed" || !quality.replyText) {
        return {
          status: "reply_generation_failed",
          xPostId: claimed.xPostId,
          perceptionEventId: claimed.perceptionEventId,
          judgementId: claimed.judgementId,
          finalAction,
          policyCode: "reply_generation_failed",
          policyOutcome: "reply_generation_failed",
          effectsCreated: 0,
          replyRecovery: "failed",
          recoveryCalls,
          speechQuality,
          error: quality.error ?? "reply quality path failed",
        };
      }

      finalReplyText = quality.replyText;
      replyRecovery = quality.replyRecovery;
      if (quality.wallSuppressed) {
        finalWallBody = null;
        if (finalAction === "reply_and_write_to_wall") {
          finalAction = "reply_on_x";
        }
      } else {
        finalWallBody = quality.wallBody;
      }
    }

    // --- Stage 3 Chronicler (I/O outside pure authority) ---
    let alreadyRemembered = false;
    const rawCandidate = claimed.finalWallCandidate;
    if (
      rawCandidate &&
      typeof rawCandidate === "object" &&
      (rawCandidate as WallCandidate).kind === "public_fact"
    ) {
      const pf = rawCandidate as Extract<WallCandidate, { kind: "public_fact" }>;
      const checkRemembered = deps.isRemembered ?? isWallFactFingerprintRemembered;
      alreadyRemembered = await checkRemembered({
        factKey: pf.factKey,
        factFingerprint: pf.factFingerprint,
      });
    }

    let chronicler = evaluateChroniclerWallAdmission({
      finalAction,
      finalReplyText,
      finalWallBody,
      wallCandidate: claimed.finalWallCandidate,
      trustedFacts,
      alreadyRemembered,
      responseMode,
    });

    let reservedMemoryId: string | null = null;

    if (chronicler.decision === "allow_wall" && chronicler.candidate) {
      if (chronicler.candidate.kind === "public_fact") {
        const reserve = deps.tryReserve ?? tryReserveWallFactMemory;
        const reserved = await reserve({
          factKey: chronicler.candidate.factKey,
          factFingerprint: chronicler.candidate.factFingerprint,
          reason: chronicler.candidate.reason,
          perceptionEventId: claimed.perceptionEventId,
        });
        if (reserved.status === "already_exists") {
          finalAction = "reply_on_x";
          finalWallBody = null;
          chronicler = {
            ...chronicler,
            decision: "suppress_wall",
            code: "already_remembered",
            observability: {
              ...chronicler.observability,
              admitted: false,
              alreadyRemembered: true,
            },
          };
        } else if (reserved.status === "failed") {
          finalAction = "reply_on_x";
          finalWallBody = null;
          chronicler = {
            ...chronicler,
            decision: "suppress_wall",
            code: "significance_rejected",
            observability: {
              ...chronicler.observability,
              admitted: false,
            },
          };
        } else {
          reservedMemoryId = reserved.memoryId;
          finalAction = "reply_and_write_to_wall";
        }
      } else {
        finalAction = "reply_and_write_to_wall";
      }
    } else if (finalAction === "reply_and_write_to_wall") {
      finalAction = "reply_on_x";
      finalWallBody = null;
    }

    const decision = evaluateAuthorityDecision({
      perceptionEventId: claimed.perceptionEventId,
      judgementId: claimed.judgementId,
      xPostId: claimed.xPostId,
      perceptionType: claimed.perceptionType,
      finalStatus: claimed.finalStatus,
      finalAction,
      finalReplyText,
      finalWallBody,
      finalReasonCode,
    });

    // Attach Chronicler memory id into wall effect payload when planned.
    if (reservedMemoryId && decision.outcome === "permitted") {
      for (const effect of decision.effects) {
        if (effect.type === "write_to_wall") {
          effect.payload = {
            ...effect.payload,
            chroniclerFactMemoryId: reservedMemoryId,
          };
        }
      }
    }

    const isDeskWallOnly =
      decision.policyCode === "permitted_wall" &&
      decision.effects.every((e) => e.type === "write_to_wall");

    if (
      decision.outcome === "permitted" &&
      !isDeskWallOnly &&
      !decision.effects.some((e) => e.type === "reply_on_x")
    ) {
      return {
        status: "reply_generation_failed",
        xPostId: claimed.xPostId,
        perceptionEventId: claimed.perceptionEventId,
        judgementId: claimed.judgementId,
        finalAction: decision.finalAction,
        policyOutcome: "policy_invariant_violation",
        effectsCreated: 0,
        replyRecovery,
        recoveryCalls,
        chronicler: {
          decision: chronicler.decision,
          code: chronicler.code,
          kind: chronicler.observability.kind,
          factKey: chronicler.observability.factKey,
          factFingerprint: chronicler.observability.factFingerprint,
          admitted: chronicler.observability.admitted,
          alreadyRemembered: chronicler.observability.alreadyRemembered,
        },
        error: "eligible permitted plan has no reply effect",
      };
    }

    if (
      (finalAction === "reply_on_x" ||
        finalAction === "reply_and_write_to_wall") &&
      (decision.policyCode === "missing_reply_candidate" ||
        (decision.effects.length === 0 && decision.outcome === "denied"))
    ) {
      return {
        status: "reply_generation_failed",
        xPostId: claimed.xPostId,
        perceptionEventId: claimed.perceptionEventId,
        judgementId: claimed.judgementId,
        finalAction,
        policyCode: decision.policyCode,
        policyOutcome: "reply_generation_failed",
        effectsCreated: 0,
        replyRecovery: replyRecovery === "not_needed" ? "failed" : replyRecovery,
        recoveryCalls,
        error: "reply candidate still missing after recovery path",
      };
    }

    const persisted = await persistXPerceptionAuthorization(
      {
        perceptionEventId: claimed.perceptionEventId,
        judgementId: claimed.judgementId,
        decision,
      },
      { admin: deps.admin },
    );

    if (reservedMemoryId && persisted.created && persisted.authorizationId) {
      try {
        await attachAuthorizationToWallFactMemory({
          memoryId: reservedMemoryId,
          authorizationId: persisted.authorizationId,
          // Prefer injected admin when present; optional link must never fail the tick.
          admin: deps.admin as never,
        });
      } catch {
        // non-fatal link
      }
    }

    if (!persisted.created) {
      return {
        status: "already_authorised",
        xPostId: claimed.xPostId,
        perceptionEventId: claimed.perceptionEventId,
        judgementId: claimed.judgementId,
        finalAction: decision.finalAction,
        outcome: persisted.outcome,
        policyCode: persisted.policyCode,
        policyOutcome: decision.policyOutcome,
        effectsCreated: persisted.effectsCreated,
        replyRecovery,
        recoveryCalls,
        chronicler: {
          decision: chronicler.decision,
          code: chronicler.code,
          kind: chronicler.observability.kind,
          factKey: chronicler.observability.factKey,
          factFingerprint: chronicler.observability.factFingerprint,
          admitted: chronicler.observability.admitted,
          alreadyRemembered: chronicler.observability.alreadyRemembered,
        },
      };
    }

    console.info("[chronicler] authority", {
      xPostId: claimed.xPostId,
      decision: chronicler.decision,
      code: chronicler.code,
      kind: chronicler.observability.kind,
      factKey: chronicler.observability.factKey,
      factFingerprint: chronicler.observability.factFingerprint,
      admitted: chronicler.observability.admitted,
      alreadyRemembered: chronicler.observability.alreadyRemembered,
      finalAction: decision.finalAction,
      policyCode: persisted.policyCode,
      speechQuality,
    });

    return {
      status: "authorised",
      xPostId: claimed.xPostId,
      perceptionEventId: claimed.perceptionEventId,
      judgementId: claimed.judgementId,
      finalAction: decision.finalAction,
      outcome: persisted.outcome,
      policyCode: persisted.policyCode,
      policyOutcome: decision.policyOutcome,
      effectsCreated: persisted.effectsCreated,
      replyRecovery,
      recoveryCalls,
      speechQuality,
      chronicler: {
        decision: chronicler.decision,
        code: chronicler.code,
        kind: chronicler.observability.kind,
        factKey: chronicler.observability.factKey,
        factFingerprint: chronicler.observability.factFingerprint,
        admitted: chronicler.observability.admitted,
        alreadyRemembered: chronicler.observability.alreadyRemembered,
      },
    };
  } catch (error) {
    return {
      status: "failed",
      xPostId: claimed.xPostId,
      perceptionEventId: claimed.perceptionEventId,
      judgementId: claimed.judgementId,
      error: error instanceof Error ? error.message : "authority failed",
    };
  }
}

export async function authorizePendingXPerceptions(
  options: { limit?: number } = {},
  deps: Stage125Deps = {},
): Promise<AuthorizeBatchAggregate> {
  const limit = clampBatchLimit(options.limit);
  const results: AuthorizeOneResult[] = [];
  let authorised = 0;
  let alreadyAuthorised = 0;
  let failed = 0;
  let replyGenerationFailed = 0;

  for (let i = 0; i < limit; i += 1) {
    const one = await authorizeOneXPerception(deps);
    if (one.status === "empty") break;
    results.push(one);
    if (one.status === "authorised") authorised += 1;
    else if (one.status === "already_authorised") alreadyAuthorised += 1;
    else if (one.status === "reply_generation_failed") {
      replyGenerationFailed += 1;
      failed += 1;
    } else if (one.status === "failed") failed += 1;
  }

  return {
    scanned: results.length,
    authorised,
    alreadyAuthorised,
    failed,
    replyGenerationFailed,
    results,
  };
}

export function formatAuthorizeBatchReport(
  agg: AuthorizeBatchAggregate,
): string {
  const lines = [
    "X authority",
    `scanned: ${agg.scanned}`,
    `authorised: ${agg.authorised}`,
    `already_authorised: ${agg.alreadyAuthorised}`,
    `failed: ${agg.failed}`,
    `reply_generation_failed: ${agg.replyGenerationFailed}`,
  ];

  for (const r of agg.results) {
    if (r.status === "failed" || r.status === "reply_generation_failed") {
      lines.push(
        `- ${r.status} x_post_id=${r.xPostId ?? "?"} error=${r.error ?? "?"}` +
          (r.replyRecovery ? ` recovery=${r.replyRecovery}` : ""),
      );
      continue;
    }
    lines.push(
      [
        `- ${r.status}`,
        `x_post_id=${r.xPostId ?? "?"}`,
        `final_action=${r.finalAction ?? "?"}`,
        `outcome=${r.outcome ?? "?"}`,
        `policy_outcome=${r.policyOutcome ?? "?"}`,
        `policy_code=${r.policyCode ?? "?"}`,
        `effects=${r.effectsCreated ?? 0}`,
        r.replyRecovery ? `recovery=${r.replyRecovery}` : null,
        r.chronicler
          ? `chronicler=${r.chronicler.decision}:${r.chronicler.code}`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  return lines.join("\n");
}
