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
  replyRecovery?: "not_needed" | "succeeded" | "failed" | "skipped";
  recoveryCalls?: number;
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
};

function clampBatchLimit(limit: number | undefined): number {
  const n = Math.floor(limit ?? STAGE125_AUTHORITY_BATCH_DEFAULT);
  if (!Number.isFinite(n) || n < 1) return STAGE125_AUTHORITY_BATCH_DEFAULT;
  return Math.min(n, STAGE125_AUTHORITY_BATCH_MAX);
}

/**
 * Claim one finalized judgement, recover reply if needed, evaluate policy,
 * persist authority + pending effects. Does not execute consequences.
 *
 * Recovery failure is operational: no authorization is written so a later run
 * can re-claim and retry generation. Wall effects are not planned without a reply.
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

    if (
      intentionNeedsReplyRecovery({
        action: finalAction,
        reasonCode: finalReasonCode,
        replyText: finalReplyText,
      })
    ) {
      const knowledgeBoundary =
        !claimed.liveStateAvailable && claimed.needsLiveState.length > 0
          ? "Trusted live state was unavailable. Answer honestly that you cannot establish the current figure; do not invent numbers."
          : "Answer only from public knowledge implied by the mention. Do not invent private Outlaw facts or live balances.";

      const recovered = await ensureReplyTextWithRecovery({
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
        callModel: deps.callReplyRecovery,
      });

      recoveryCalls = recovered.recoveryCalls;

      if (recovered.status === "failed") {
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
          error: recovered.error,
        };
      }

      if (recovered.status === "succeeded") {
        finalReplyText = recovered.replyText;
        replyRecovery = "succeeded";
      } else if (recovered.status === "not_needed") {
        finalReplyText = recovered.replyText;
        replyRecovery = "not_needed";
      } else {
        // skipped should not happen for needs-recovery path
        return {
          status: "reply_generation_failed",
          xPostId: claimed.xPostId,
          perceptionEventId: claimed.perceptionEventId,
          judgementId: claimed.judgementId,
          finalAction,
          policyOutcome: "reply_generation_failed",
          effectsCreated: 0,
          replyRecovery: "failed",
          recoveryCalls,
          error: recovered.error ?? "recovery skipped unexpectedly",
        };
      }
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

    // Desk wall-only is the only permitted plan without reply_on_x.
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
      };
    }

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
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  return lines.join("\n");
}
