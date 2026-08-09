import "server-only";

import { assemblePublicAgentContext } from "@/lib/agent/stage12-contract";
import {
  safeRetrievePublicAgentKnowledge,
  type PublicAgentKnowledgeLookup,
} from "@/lib/agent/knowledge";
import {
  STAGE12_JUDGE_BATCH_DEFAULT,
  STAGE12_JUDGE_BATCH_MAX,
} from "@/lib/agent/judge-config";
import { AgentJudgeError } from "@/lib/agent/judge-errors";
import { runFennPublicJudgement, type JudgeModelCaller } from "@/lib/agent/judge-model";
import {
  claimXPerceptionForJudgement,
  failXPerceptionJudgement,
  finalizeXPerceptionJudgement,
  type ClaimedPerception,
} from "@/lib/agent/judge-persist";
import type { Stage12JudgementIntention } from "@/lib/agent/judge-schema";
import { processAuthorWalletCollectionTurn } from "@/lib/agent/wallet-collection-handler";

export type JudgeOneResult = {
  status: "judged" | "already_judged" | "failed" | "empty";
  xPostId?: string;
  eventId?: string;
  created?: boolean;
  action?: string;
  reasonCode?: string;
  needsLiveState?: string[];
  identityUnverified?: boolean;
  /** P1D observability */
  walletCollection?: string;
  error?: string;
};

export type JudgeBatchAggregate = {
  scanned: number;
  judged: number;
  alreadyJudged: number;
  failed: number;
  empty: boolean;
  results: JudgeOneResult[];
};

type JudgeDeps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin?: any;
  callModel?: JudgeModelCaller;
  retrieveKnowledge?: (query: string) => Promise<PublicAgentKnowledgeLookup>;
};

/**
 * Claim one pending perception → public knowledge → judgement → persist intention.
 * Does not post to X, write Wall, mutate memory, or call live tools.
 */
export async function judgeOneXPerception(
  deps: JudgeDeps = {},
): Promise<JudgeOneResult> {
  let claimed: ClaimedPerception | null;
  try {
    claimed = await claimXPerceptionForJudgement({ admin: deps.admin });
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "claim failed",
    };
  }

  if (!claimed) {
    return { status: "empty" };
  }

  if (claimed.alreadyJudged) {
    return {
      status: "already_judged",
      xPostId: claimed.xPostId,
      eventId: claimed.eventId,
    };
  }

  try {
    // Stage P1D: active wallet-collection turns intercept free economic judgement.
    const walletTurn = await processAuthorWalletCollectionTurn({
      authorXUserId: claimed.authorXUserId,
      xPostId: claimed.xPostId,
      body: claimed.body,
      admin: deps.admin,
    });

    if (walletTurn.handled && walletTurn.replyText) {
      const intention: Stage12JudgementIntention = {
        engage: true,
        action: "reply_on_x",
        reasonCode: "answered_from_public_knowledge",
        replyText: walletTurn.replyText.slice(0, 280),
        wallBody: null,
        needsLiveState: [],
        identityUnverified: false,
        responseMode: "canon",
        wallCandidate: null,
        knowledgeAvailable: true,
        model: "p1d-wallet-collection",
        promptVersion: "p1d-v1",
      };
      const finalized = await finalizeXPerceptionJudgement(
        {
          perceptionEventId: claimed.eventId,
          intention,
        },
        { admin: deps.admin },
      );
      return {
        status: "judged",
        xPostId: claimed.xPostId,
        eventId: claimed.eventId,
        created: finalized.created,
        action: finalized.action,
        reasonCode: finalized.reasonCode,
        needsLiveState: [],
        identityUnverified: false,
        walletCollection: walletTurn.kind,
      };
    }

    const knowledge = deps.retrieveKnowledge
      ? await deps.retrieveKnowledge(claimed.body)
      : await safeRetrievePublicAgentKnowledge({ query: claimed.body });

    const assembled = assemblePublicAgentContext({ knowledge });

    const intention = await runFennPublicJudgement({
      xPostId: claimed.xPostId,
      perceptionType: claimed.perceptionType,
      authorXUserId: claimed.authorXUserId,
      authorUsername: claimed.authorUsername,
      body: claimed.body,
      knowledgeAvailable: assembled.knowledgeAvailable,
      knowledgeContext: assembled.knowledgeContext,
      callModel: deps.callModel,
    });

    const finalized = await finalizeXPerceptionJudgement(
      {
        perceptionEventId: claimed.eventId,
        intention,
      },
      { admin: deps.admin },
    );

    return {
      status: "judged",
      xPostId: claimed.xPostId,
      eventId: claimed.eventId,
      created: finalized.created,
      action: finalized.action,
      reasonCode: finalized.reasonCode,
      needsLiveState: intention.needsLiveState,
      identityUnverified: intention.identityUnverified,
    };
  } catch (error) {
    const message =
      error instanceof AgentJudgeError
        ? error.message
        : error instanceof Error
          ? error.message
          : "judgement failed";

    try {
      await failXPerceptionJudgement(
        { perceptionEventId: claimed.eventId, error: message },
        { admin: deps.admin },
      );
    } catch {
      // Persistence of failure is best-effort; surface original error.
    }

    return {
      status: "failed",
      xPostId: claimed.xPostId,
      eventId: claimed.eventId,
      error: message,
    };
  }
}

/**
 * Bounded batch for operator dry-run / future cron.
 */
export async function judgePendingXPerceptions(
  options: { limit?: number } = {},
  deps: JudgeDeps = {},
): Promise<JudgeBatchAggregate> {
  const limit = Math.min(
    Math.max(1, options.limit ?? STAGE12_JUDGE_BATCH_DEFAULT),
    STAGE12_JUDGE_BATCH_MAX,
  );

  const results: JudgeOneResult[] = [];
  let judged = 0;
  let alreadyJudged = 0;
  let failed = 0;

  for (let i = 0; i < limit; i += 1) {
    const one = await judgeOneXPerception(deps);
    if (one.status === "empty") {
      break;
    }
    results.push(one);
    if (one.status === "judged") judged += 1;
    else if (one.status === "already_judged") alreadyJudged += 1;
    else if (one.status === "failed") failed += 1;
  }

  return {
    scanned: results.length,
    judged,
    alreadyJudged,
    failed,
    empty: results.length === 0,
    results,
  };
}

/** Pure helper for tests — build intention path without DB. */
export async function judgePerceptionContent(input: {
  xPostId: string;
  perceptionType?: string;
  authorXUserId: string;
  authorUsername?: string | null;
  body: string;
  knowledge: PublicAgentKnowledgeLookup;
  callModel: JudgeModelCaller;
}): Promise<Stage12JudgementIntention> {
  const assembled = assemblePublicAgentContext({ knowledge: input.knowledge });
  return runFennPublicJudgement({
    xPostId: input.xPostId,
    perceptionType: input.perceptionType ?? "mention",
    authorXUserId: input.authorXUserId,
    authorUsername: input.authorUsername ?? null,
    body: input.body,
    knowledgeAvailable: assembled.knowledgeAvailable,
    knowledgeContext: assembled.knowledgeContext,
    callModel: input.callModel,
  });
}

export function formatJudgeBatchReport(agg: JudgeBatchAggregate): string {
  const lines = [
    "X judgement",
    `scanned: ${agg.scanned}`,
    `judged: ${agg.judged}`,
    `already_judged: ${agg.alreadyJudged}`,
    `failed: ${agg.failed}`,
  ];
  for (const r of agg.results) {
    if (r.status === "judged" || r.status === "already_judged") {
      lines.push(
        `- ${r.xPostId}: ${r.action ?? "(existing)"} / ${r.reasonCode ?? "n/a"}`,
      );
    } else if (r.status === "failed") {
      lines.push(
        `- ${r.xPostId ?? "?"}: failed${r.error ? ` (${r.error})` : ""}`,
      );
    }
  }
  return lines.join("\n");
}
