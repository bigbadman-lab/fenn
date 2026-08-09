import "server-only";

import { safeRetrievePublicAgentKnowledge, assemblePublicAgentContext } from "@/lib/agent/stage12-contract";
import {
  claimXPerceptionJudgementForLiveState,
  finalizeXPerceptionJudgementWithLiveState,
} from "@/lib/agent/judge-persist";

import {
  executeStage124LiveReads,
  buildStage124LiveStatePromptBlock,
  collectFactsFromLiveResults,
  type Stage124LiveReadResult,
} from "@/lib/agent/stage124-live-adapters";
import type { Stage124LiveCapability } from "@/lib/agent/stage124-live-capabilities";
import {
  draftAssertsUnsupportedPublicQuantity,
  resolveExecutableLiveCapabilities,
} from "@/lib/agent/live-capability-routing";
import {
  buildPublicFactEvidencePromptBlock,
  type PublicFactEvidence,
} from "@/lib/agent/public-fact-evidence";
import { inferResponseModeFromBody } from "@/lib/agent/response-mode";

import { runFennPublicFinalJudgement } from "@/lib/agent/stage124-final-judge-model";

import { STAGE12_JUDGE_OPENAI_MODEL } from "@/lib/agent/judge-config";
import type { PublicAgentKnowledgeLookup } from "@/lib/agent/knowledge";
import { applyReplyGuaranteePolicy } from "@/lib/agent/reply-guarantee-policy";
import {
  ensureReplyTextWithRecovery,
  intentionNeedsReplyRecovery,
  type ReplyRecoveryModelCaller,
} from "@/lib/agent/reply-recovery";
import {
  formatPurseEconomicStateForPrompt,
  loadPurseEconomicState,
} from "@/lib/agent/purse-economic-context";
import { economicIntentToJson } from "@/lib/agent/economic-intent";
import { resolveTrustedTransferRecipient } from "@/lib/agent/trusted-recipient";

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
  /** Stage P1B: optional overrides (e.g. harness purse state loader). */
  loadPurseState?: typeof loadPurseEconomicState;
  harnessBoundWallet?: string | null;
  forcePurseTestRail?: boolean;
};

/** Filter requested caps to executable Stage 124 set (no silent personal leaf). */
export function validateRequestedCapabilities(
  requested: string[],
  body?: string,
): Stage124LiveCapability[] {
  return resolveExecutableLiveCapabilities({
    requested,
    body,
    responseMode: body ? inferResponseModeFromBody(body) : null,
    inferFromBodyIfEmpty: false,
  });
}

async function finalizeWithHonestRecovery(input: {
  claimed: {
    perceptionEventId: string;
    xPostId: string;
    perceptionType: string;
    authorXUserId: string;
    authorUsername: string | null;
    body: string;
    identityUnverified: boolean;
  };
  liveStateAvailable: boolean;
  liveStateSucceeded: Stage124LiveCapability[];
  liveStateFailed: Stage124LiveCapability[];
  factBlock: string | null;
  knowledgeBoundaryNote: string;
  promptVersion: string;
  deps: Stage124Deps;
}): Promise<SightOneResult> {
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
    xPostId: input.claimed.xPostId,
    perceptionType: input.claimed.perceptionType,
    authorXUserId: input.claimed.authorXUserId,
    authorUsername: input.claimed.authorUsername,
    body: input.claimed.body,
    knowledgeBoundaryNote: input.knowledgeBoundaryNote,
    publicFactEvidenceBlock: input.factBlock,
    callModel: input.deps.callReplyRecovery,
  });

  if (recovered.status === "failed") {
    return {
      status: "failed",
      xPostId: input.claimed.xPostId,
      perceptionEventId: input.claimed.perceptionEventId,
      finalAction: "reply_on_x",
      finalReasonCode: "reply_generation_failed",
      liveStateAvailable: input.liveStateAvailable,
      error: recovered.error,
    };
  }

  const replyText =
    recovered.status === "succeeded" || recovered.status === "not_needed"
      ? recovered.replyText
      : null;

  await finalizeXPerceptionJudgementWithLiveState(
    {
      perceptionEventId: input.claimed.perceptionEventId,
      finalStatus: "finalized",
      liveStateAvailable: input.liveStateAvailable,
      liveStateSucceeded: [...input.liveStateSucceeded],
      liveStateFailed: [...input.liveStateFailed],
      finalAction: "reply_on_x",
      finalReasonCode: "insufficient_knowledge",
      finalEngage: true,
      finalReplyText: replyText,
      finalWallBody: null,
      finalIdentityUnverified: input.claimed.identityUnverified,
      finalModel: STAGE12_JUDGE_OPENAI_MODEL,
      finalPromptVersion: input.promptVersion,
    },
    { admin: input.deps.admin },
  );

  return {
    status: "finalized",
    xPostId: input.claimed.xPostId,
    perceptionEventId: input.claimed.perceptionEventId,
    finalAction: "reply_on_x",
    finalReasonCode: "insufficient_knowledge",
    liveStateAvailable: input.liveStateAvailable,
  };
}

async function runLiveThenJudgePath(input: {
  claimed: {
    perceptionEventId: string;
    xPostId: string;
    perceptionType: string;
    authorXUserId: string;
    authorUsername: string | null;
    body: string;
    identityUnverified: boolean;
  };
  requestedCaps: Stage124LiveCapability[];
  deps: Stage124Deps;
}): Promise<SightOneResult> {
  const execLive = input.deps.executeLiveReads ?? executeStage124LiveReads;
  const liveResults = await execLive(input.requestedCaps);
  const trustedLiveStateBlock = buildStage124LiveStatePromptBlock(
    liveResults.results,
  );
  const facts = liveResults.facts?.length
    ? liveResults.facts
    : collectFactsFromLiveResults(liveResults.results);
  const factBlock =
    facts.length > 0 ? buildPublicFactEvidencePromptBlock(facts) : null;
  const anyLiveAvailable = liveResults.succeeded.length > 0;

  if (!anyLiveAvailable) {
    return finalizeWithHonestRecovery({
      claimed: input.claimed,
      liveStateAvailable: false,
      liveStateSucceeded: [],
      liveStateFailed: [...liveResults.failed],
      factBlock,
      knowledgeBoundaryNote:
        "Trusted live tools were unavailable. Answer honestly that you cannot establish the current figure. Do not invent numbers. Do not use technical infrastructure language.",
      promptVersion: "fenn-public-final-judge-live-unavailable-recovery-v1",
      deps: input.deps,
    });
  }

  try {
    const knowledgeLookup = input.deps.retrieveKnowledge
      ? await input.deps.retrieveKnowledge(input.claimed.body)
      : await safeRetrievePublicAgentKnowledge({ query: input.claimed.body });
    const assembled = assemblePublicAgentContext({
      knowledge: knowledgeLookup,
    });

    const purseLoader =
      input.deps.loadPurseState ?? loadPurseEconomicState;
    let purseBlock: string | null = null;
    let trustedWalletAvailable = false;
    try {
      const purseState = await purseLoader({
        forceTestRail: Boolean(input.deps.forcePurseTestRail),
      });
      purseBlock = formatPurseEconomicStateForPrompt(purseState);
      const resolved = resolveTrustedTransferRecipient({
        harnessBoundWallet: input.deps.harnessBoundWallet,
      });
      trustedWalletAvailable = resolved.ok;
    } catch {
      purseBlock = [
        "=== TRUSTED PURSE STATE (THE PURSE) ===",
        "Purse state unavailable. Prefer economicAction NONE.",
      ].join("\n");
    }

    const finalIntention = await (input.deps.runFinalJudgement ??
      runFennPublicFinalJudgement)({
      xPostId: input.claimed.xPostId,
      perceptionType: input.claimed.perceptionType,
      authorXUserId: input.claimed.authorXUserId,
      authorUsername: input.claimed.authorUsername,
      body: input.claimed.body,
      knowledgeAvailable: assembled.knowledgeAvailable,
      knowledgeContext: assembled.knowledgeContext,
      trustedLiveStateBlock,
      publicFactEvidenceBlock: factBlock,
      trustedFacts: facts,
      liveStateAnyAvailable: anyLiveAvailable,
      trustedPurseStateBlock: purseBlock,
      trustedWalletAvailable,
    });

    let finalAction = finalIntention.action;
    let finalReplyText = finalIntention.replyText;
    let finalWallBody = finalIntention.wallBody;
    let finalReasonCode = finalIntention.reasonCode;
    let finalEngage = finalIntention.engage;
    const finalWallCandidate = finalIntention.wallCandidate ?? null;
    const finalEconomicIntent = economicIntentToJson(
      finalIntention.economicIntent ?? { type: "NONE" },
    );

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
        xPostId: input.claimed.xPostId,
        perceptionType: input.claimed.perceptionType,
        authorXUserId: input.claimed.authorXUserId,
        authorUsername: input.claimed.authorUsername,
        body: input.claimed.body,
        publicFactEvidenceBlock: factBlock,
        callModel: input.deps.callReplyRecovery,
      });
      if (recovered.status === "failed") {
        return {
          status: "failed",
          xPostId: input.claimed.xPostId,
          perceptionEventId: input.claimed.perceptionEventId,
          error: recovered.error,
        };
      }
      if (
        recovered.status === "succeeded" ||
        recovered.status === "not_needed"
      ) {
        finalReplyText = recovered.replyText;
        finalEngage = true;
      }
    }

    await finalizeXPerceptionJudgementWithLiveState(
      {
        perceptionEventId: input.claimed.perceptionEventId,
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
        finalWallCandidate,
        finalEconomicIntent,
      },
      { admin: input.deps.admin },
    );

    return {
      status: "finalized",
      xPostId: input.claimed.xPostId,
      perceptionEventId: input.claimed.perceptionEventId,
      finalAction,
      finalReasonCode,
      liveStateAvailable: anyLiveAvailable,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "final judgement failed";
    await finalizeXPerceptionJudgementWithLiveState(
      {
        perceptionEventId: input.claimed.perceptionEventId,
        finalStatus: "failed",
        liveStateAvailable: anyLiveAvailable,
        liveStateSucceeded: [...liveResults.succeeded],
        liveStateFailed: [...liveResults.failed],
        finalAction: "do_nothing",
        finalReasonCode: "insufficient_knowledge",
        finalEngage: false,
        finalReplyText: null,
        finalWallBody: null,
        finalIdentityUnverified: input.claimed.identityUnverified,
        finalModel: "n/a",
        finalPromptVersion: "n/a",
        finalEconomicIntent: { type: "NONE" },
      },
      { admin: input.deps.admin },
    );
    return {
      status: "failed",
      xPostId: input.claimed.xPostId,
      perceptionEventId: input.claimed.perceptionEventId,
      error: message,
    };
  }
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

  const responseMode = inferResponseModeFromBody(claimed.body);
  let requestedCaps = resolveExecutableLiveCapabilities({
    requested: claimed.needsLiveState,
    body: claimed.body,
    responseMode,
    inferFromBodyIfEmpty: false,
  });

  const finalModelNoop = STAGE12_JUDGE_OPENAI_MODEL;
  const finalPromptCopy = "fenn-public-final-judge-copy-v1";

  // Stage 2 copy-forward / empty needs: infer approved fact capabilities for
  // fact-like questions so we do not keep unsupported quantitative drafts.
  if (requestedCaps.length === 0) {
    const inferred = resolveExecutableLiveCapabilities({
      requested: [],
      body: claimed.body,
      responseMode,
      inferFromBodyIfEmpty: true,
    });
    if (inferred.length > 0) {
      requestedCaps = inferred;
    }
  }

  if (requestedCaps.length > 0) {
    return runLiveThenJudgePath({
      claimed: {
        perceptionEventId: claimed.perceptionEventId,
        xPostId: claimed.xPostId,
        perceptionType: claimed.perceptionType,
        authorXUserId: claimed.authorXUserId,
        authorUsername: claimed.authorUsername,
        body: claimed.body,
        identityUnverified: claimed.identityUnverified,
      },
      requestedCaps,
      deps,
    });
  }

  // Pure copy-forward path — no executable live caps after inference.
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

  // Still refuse unsupported quantitative drafts (empty inferred caps case).
  if (
    draftAssertsUnsupportedPublicQuantity({
      body: claimed.body,
      replyText: finalReplyText,
      loadedCapabilities: [],
      availableFactKeys: [],
    })
  ) {
    return finalizeWithHonestRecovery({
      claimed: {
        perceptionEventId: claimed.perceptionEventId,
        xPostId: claimed.xPostId,
        perceptionType: claimed.perceptionType,
        authorXUserId: claimed.authorXUserId,
        authorUsername: claimed.authorUsername,
        body: claimed.body,
        identityUnverified: claimed.identityUnverified,
      },
      liveStateAvailable: false,
      liveStateSucceeded: [],
      liveStateFailed: [],
      factBlock: null,
      knowledgeBoundaryNote:
        "A prior draft asserted a public quantity without trusted evidence. Answer honestly that you cannot establish the current figure. Do not invent numbers or claim 'many' without a count.",
      promptVersion:
        "fenn-public-final-judge-copy-unsupported-quantity-recovery-v1",
      deps,
    });
  }

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
      finalEconomicIntent: { type: "NONE" },
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

export function formatSightBatchReport(agg: SightBatchAggregate): string {
  return [
    "X live sight",
    `scanned: ${agg.scanned}`,
    `finalized: ${agg.finalized}`,
    `already_finalized: ${agg.alreadyFinalized}`,
    `failed: ${agg.failed}`,
  ].join("\n");
}

/** Test helper — re-export live types when needed. */
export type { Stage124LiveReadResult, PublicFactEvidence };
