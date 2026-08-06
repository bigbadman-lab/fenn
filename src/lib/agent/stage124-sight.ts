import "server-only";

import { safeRetrievePublicAgentKnowledge, assemblePublicAgentContext } from "@/lib/agent/stage12-contract";
import {
  claimXPerceptionJudgementForLiveState,
  finalizeXPerceptionJudgementWithLiveState,
} from "@/lib/agent/judge-persist";

import { executeStage124LiveReads, buildStage124LiveStatePromptBlock } from "@/lib/agent/stage124-live-adapters";
import type { Stage124LiveCapability } from "@/lib/agent/stage124-live-capabilities";
import {
  STAGE124_LIVE_CAPABILITIES,
  STAGE124_LIVE_CAPABILITY_MAX,
} from "@/lib/agent/stage124-live-capabilities";

import { runFennPublicFinalJudgement } from "@/lib/agent/stage124-final-judge-model";

import { STAGE12_JUDGE_OPENAI_MODEL } from "@/lib/agent/judge-config";
import type { PublicAgentKnowledgeLookup } from "@/lib/agent/knowledge";
import { applyReplyGuaranteePolicy } from "@/lib/agent/reply-guarantee-policy";
import {
  ensureReplyTextWithRecovery,
  intentionNeedsReplyRecovery,
  type ReplyRecoveryModelCaller,
} from "@/lib/agent/reply-recovery";

type AdminLike = {
  from: (table: string) => unknown;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type SightOneResult = {
  status: "finalized" | "already_finalized" | "empty" | "failed";
  xPostId?: string;
  perceptionEventId?: string;
  finalAction?: string;
  finalReasonCode?: string;
  liveStateAvailable?: boolean;
  error?: string;
};

export type SightBatchAggregate = {
  scanned: number;
  finalized: number;
  alreadyFinalized: number;
  failed: number;
  results: SightOneResult[];
};

type Stage124Deps = {
  admin?: AdminLike;
  executeLiveReads?: typeof executeStage124LiveReads;
  retrieveKnowledge?: (query: string) => Promise<PublicAgentKnowledgeLookup>;
  runFinalJudgement?: typeof runFennPublicFinalJudgement;
  callReplyRecovery?: ReplyRecoveryModelCaller;
};

function validateRequestedCapabilities(
  requested: string[],
): Stage124LiveCapability[] {
  const allowed = new Set(STAGE124_LIVE_CAPABILITIES);
  const unique: Stage124LiveCapability[] = [];
  for (const cap of requested) {
    if (typeof cap === "string" && allowed.has(cap as Stage124LiveCapability)) {
      unique.push(cap as Stage124LiveCapability);
    }
  }
  // Deterministic cap for prompt+latency safety.
  return [...new Set(unique)].slice(0, STAGE124_LIVE_CAPABILITY_MAX);
}

export async function finalizeOneXPerceptionJudgementWithLiveState(
  deps: Stage124Deps = {},
): Promise<SightOneResult> {
  let claimed;
  try {
    claimed = await claimXPerceptionJudgementForLiveState({ admin: deps.admin });
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "claim failed",
    };
  }

  if (!claimed) return { status: "empty" };
  if (claimed.alreadyFinalized) {
    return {
      status: "already_finalized",
      xPostId: claimed.xPostId,
      perceptionEventId: claimed.perceptionEventId,
    };
  }

  const requestedCaps = validateRequestedCapabilities(claimed.needsLiveState);
  const finalModelNoop = STAGE12_JUDGE_OPENAI_MODEL;
  const finalPromptCopy = "fenn-public-final-judge-copy-v1";

  if (requestedCaps.length === 0) {
    // Copy-forward initial intention, then apply guarantee + recovery if needed.
    const guaranteed = applyReplyGuaranteePolicy({
      engage: claimed.initialEngage,
      action: claimed.initialAction,
      reasonCode: claimed.initialReasonCode,
      replyText: claimed.initialReplyText,
      wallBody: claimed.initialWallBody,
      allowDeferredLiveSilence: false,
    });

    let finalAction = guaranteed.action;
    let finalReplyText = guaranteed.replyText;
    let finalWallBody = guaranteed.wallBody;
    let finalReasonCode = guaranteed.reasonCode;
    let finalEngage = guaranteed.engage;

    if (
      intentionNeedsReplyRecovery({
        action: finalAction,
        reasonCode: finalReasonCode,
        replyText: finalReplyText,
      })
    ) {
      const recovered = await ensureReplyTextWithRecovery({
        action: finalAction,
        reasonCode: finalReasonCode,
        replyText: finalReplyText,
        wallBody: finalWallBody,
        xPostId: claimed.xPostId,
        perceptionType: claimed.perceptionType,
        authorXUserId: claimed.authorXUserId,
        authorUsername: claimed.authorUsername,
        body: claimed.body,
        callModel: deps.callReplyRecovery,
      });
      if (recovered.status === "failed") {
        // Leave final_status pending so a later run can re-attempt recovery.
        // Do not finalize as do_nothing / hard block.
        return {
          status: "failed",
          xPostId: claimed.xPostId,
          perceptionEventId: claimed.perceptionEventId,
          finalAction,
          finalReasonCode: "reply_generation_failed",
          error: recovered.error,
        };
      }
      if (recovered.status === "succeeded" || recovered.status === "not_needed") {
        finalReplyText = recovered.replyText;
        finalEngage = true;
      }
    }

    await finalizeXPerceptionJudgementWithLiveState(
      {
        perceptionEventId: claimed.perceptionEventId,
        finalStatus: "finalized",
        liveStateAvailable: true,
        liveStateSucceeded: [],
        liveStateFailed: [],
        finalAction,
        finalReasonCode,
        finalEngage,
        finalReplyText,
        finalWallBody,
        finalIdentityUnverified: claimed.identityUnverified,
        finalModel: finalModelNoop,
        finalPromptVersion: finalPromptCopy,
      },
      { admin: deps.admin },
    );
    return {
      status: "finalized",
      xPostId: claimed.xPostId,
      perceptionEventId: claimed.perceptionEventId,
      finalAction,
      finalReasonCode,
      liveStateAvailable: true,
    };
  }

  const execLive = deps.executeLiveReads ?? executeStage124LiveReads;
  const liveResults = await execLive(requestedCaps);
  const trustedLiveStateBlock = buildStage124LiveStatePromptBlock(liveResults.results);
  const anyLiveAvailable = liveResults.succeeded.length > 0;

  if (!anyLiveAvailable) {
    // Eligible honest reply path: recovery writes a bounded non-fabricating answer.
    const guaranteed = applyReplyGuaranteePolicy({
      engage: true,
      action: "reply_on_x",
      reasonCode: "insufficient_knowledge",
      replyText: null,
      wallBody: null,
      allowDeferredLiveSilence: false,
    });
    const recovered = await ensureReplyTextWithRecovery({
      action: guaranteed.action,
      reasonCode: guaranteed.reasonCode,
      replyText: guaranteed.replyText,
      wallBody: null,
      xPostId: claimed.xPostId,
      perceptionType: claimed.perceptionType,
      authorXUserId: claimed.authorXUserId,
      authorUsername: claimed.authorUsername,
      body: claimed.body,
      knowledgeBoundaryNote:
        "Trusted live tools were unavailable. Answer honestly that you cannot establish the current figure. Do not invent numbers. Do not use technical infrastructure language.",
      callModel: deps.callReplyRecovery,
    });

    if (recovered.status === "failed") {
      return {
        status: "failed",
        xPostId: claimed.xPostId,
        perceptionEventId: claimed.perceptionEventId,
        finalAction: "reply_on_x",
        finalReasonCode: "reply_generation_failed",
        liveStateAvailable: false,
        error: recovered.error,
      };
    }

    const replyText =
      recovered.status === "succeeded" || recovered.status === "not_needed"
        ? recovered.replyText
        : null;

    await finalizeXPerceptionJudgementWithLiveState(
      {
        perceptionEventId: claimed.perceptionEventId,
        finalStatus: "finalized",
        liveStateAvailable: false,
        liveStateSucceeded: [],
        liveStateFailed: [...liveResults.failed],
        finalAction: "reply_on_x",
        finalReasonCode: "insufficient_knowledge",
        finalEngage: true,
        finalReplyText: replyText,
        finalWallBody: null,
        finalIdentityUnverified: claimed.identityUnverified,
        finalModel: finalModelNoop,
        finalPromptVersion: "fenn-public-final-judge-live-unavailable-recovery-v1",
      },
      { admin: deps.admin },
    );

    return {
      status: "finalized",
      xPostId: claimed.xPostId,
      perceptionEventId: claimed.perceptionEventId,
      finalAction: "reply_on_x",
      finalReasonCode: "insufficient_knowledge",
      liveStateAvailable: false,
    };
  }

  try {
    const knowledgeLookup = deps.retrieveKnowledge
      ? await deps.retrieveKnowledge(claimed.body)
      : await safeRetrievePublicAgentKnowledge({ query: claimed.body });
    const assembled = assemblePublicAgentContext({ knowledge: knowledgeLookup });

    const finalIntention = await (deps.runFinalJudgement ?? runFennPublicFinalJudgement)({
      xPostId: claimed.xPostId,
      perceptionType: claimed.perceptionType,
      authorXUserId: claimed.authorXUserId,
      authorUsername: claimed.authorUsername,
      body: claimed.body,
      knowledgeAvailable: assembled.knowledgeAvailable,
      knowledgeContext: assembled.knowledgeContext,
      trustedLiveStateBlock,
      liveStateAnyAvailable: anyLiveAvailable,
    });

    let finalAction = finalIntention.action;
    let finalReplyText = finalIntention.replyText;
    let finalWallBody = finalIntention.wallBody;
    let finalReasonCode = finalIntention.reasonCode;
    let finalEngage = finalIntention.engage;

    if (
      intentionNeedsReplyRecovery({
        action: finalAction,
        reasonCode: finalReasonCode,
        replyText: finalReplyText,
      })
    ) {
      const recovered = await ensureReplyTextWithRecovery({
        action: finalAction,
        reasonCode: finalReasonCode,
        replyText: finalReplyText,
        wallBody: finalWallBody,
        xPostId: claimed.xPostId,
        perceptionType: claimed.perceptionType,
        authorXUserId: claimed.authorXUserId,
        authorUsername: claimed.authorUsername,
        body: claimed.body,
        callModel: deps.callReplyRecovery,
      });
      if (recovered.status === "failed") {
        return {
          status: "failed",
          xPostId: claimed.xPostId,
          perceptionEventId: claimed.perceptionEventId,
          error: recovered.error,
        };
      }
      if (recovered.status === "succeeded" || recovered.status === "not_needed") {
        finalReplyText = recovered.replyText;
        finalEngage = true;
      }
    }

    await finalizeXPerceptionJudgementWithLiveState(
      {
        perceptionEventId: claimed.perceptionEventId,
        finalStatus: "finalized",
        liveStateAvailable: anyLiveAvailable,
        liveStateSucceeded: [...liveResults.succeeded],
        liveStateFailed: [...liveResults.failed],
        finalAction,
        finalReasonCode,
        finalEngage,
        finalReplyText,
        finalWallBody,
        finalIdentityUnverified: finalIntention.identityUnverified,
        finalModel: finalIntention.model,
        finalPromptVersion: finalIntention.promptVersion,
      },
      { admin: deps.admin },
    );

    return {
      status: "finalized",
      xPostId: claimed.xPostId,
      perceptionEventId: claimed.perceptionEventId,
      finalAction,
      finalReasonCode,
      liveStateAvailable: anyLiveAvailable,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "final judgement failed";
    await finalizeXPerceptionJudgementWithLiveState(
      {
        perceptionEventId: claimed.perceptionEventId,
        finalStatus: "failed",
        liveStateAvailable: anyLiveAvailable,
        liveStateSucceeded: [...liveResults.succeeded],
        liveStateFailed: [...liveResults.failed],
        finalAction: "do_nothing",
        finalReasonCode: "insufficient_knowledge",
        finalEngage: false,
        finalReplyText: null,
        finalWallBody: null,
        finalIdentityUnverified: claimed.identityUnverified,
        finalModel: "n/a",
        finalPromptVersion: "n/a",
      },
      { admin: deps.admin },
    );
    return {
      status: "failed",
      xPostId: claimed.xPostId,
      perceptionEventId: claimed.perceptionEventId,
      error: message,
    };
  }
}

export async function finalizePendingXPerceptionsWithLiveState(
  options: { limit?: number } = {},
  deps: Stage124Deps = {},
): Promise<SightBatchAggregate> {
  const limit = Math.max(1, Math.floor(options.limit ?? 5));
  const results: SightOneResult[] = [];
  let finalized = 0;
  let alreadyFinalized = 0;
  let failed = 0;

  for (let i = 0; i < limit; i += 1) {
    const one = await finalizeOneXPerceptionJudgementWithLiveState(deps);
    if (one.status === "empty") break;
    results.push(one);
    if (one.status === "finalized") finalized += 1;
    else if (one.status === "already_finalized") alreadyFinalized += 1;
    else if (one.status === "failed") failed += 1;
  }

  return {
    scanned: results.length,
    finalized,
    alreadyFinalized,
    failed,
    results,
  };
}

export function formatSightBatchReport(
  agg: SightBatchAggregate,
): string {
  return [
    "X live sight",
    `scanned: ${agg.scanned}`,
    `finalized: ${agg.finalized}`,
    `already_finalized: ${agg.alreadyFinalized}`,
    `failed: ${agg.failed}`,
  ].join("\n");
}

