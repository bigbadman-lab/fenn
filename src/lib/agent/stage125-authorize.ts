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

type AdminLike = {
  from: (table: string) => unknown;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type AuthorizeOneResult = {
  status: "authorised" | "already_authorised" | "empty" | "failed";
  xPostId?: string;
  perceptionEventId?: string;
  judgementId?: string;
  finalAction?: string;
  outcome?: string;
  policyCode?: string;
  effectsCreated?: number;
  error?: string;
};

export type AuthorizeBatchAggregate = {
  scanned: number;
  authorised: number;
  alreadyAuthorised: number;
  failed: number;
  results: AuthorizeOneResult[];
};

type Stage125Deps = {
  admin?: AdminLike;
};

function clampBatchLimit(limit: number | undefined): number {
  const n = Math.floor(limit ?? STAGE125_AUTHORITY_BATCH_DEFAULT);
  if (!Number.isFinite(n) || n < 1) return STAGE125_AUTHORITY_BATCH_DEFAULT;
  return Math.min(n, STAGE125_AUTHORITY_BATCH_MAX);
}

/**
 * Claim one finalized judgement, evaluate deterministic policy, persist
 * authority + pending effects. Does not execute consequences.
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
      effectsCreated: existing?.effects.length ?? 0,
    };
  }

  try {
    const decision = evaluateAuthorityDecision({
      perceptionEventId: claimed.perceptionEventId,
      judgementId: claimed.judgementId,
      xPostId: claimed.xPostId,
      perceptionType: claimed.perceptionType,
      finalStatus: claimed.finalStatus,
      finalAction: claimed.finalAction,
      finalReplyText: claimed.finalReplyText,
      finalWallBody: claimed.finalWallBody,
    });

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
        effectsCreated: persisted.effectsCreated,
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
      effectsCreated: persisted.effectsCreated,
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

  for (let i = 0; i < limit; i += 1) {
    const one = await authorizeOneXPerception(deps);
    if (one.status === "empty") break;
    results.push(one);
    if (one.status === "authorised") authorised += 1;
    else if (one.status === "already_authorised") alreadyAuthorised += 1;
    else if (one.status === "failed") failed += 1;
  }

  return {
    scanned: results.length,
    authorised,
    alreadyAuthorised,
    failed,
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
  ];

  for (const r of agg.results) {
    if (r.status === "failed") {
      lines.push(`- failed x_post_id=${r.xPostId ?? "?"} error=${r.error ?? "?"}`);
      continue;
    }
    lines.push(
      [
        `- ${r.status}`,
        `x_post_id=${r.xPostId ?? "?"}`,
        `final_action=${r.finalAction ?? "?"}`,
        `outcome=${r.outcome ?? "?"}`,
        `policy_code=${r.policyCode ?? "?"}`,
        `effects=${r.effectsCreated ?? 0}`,
      ].join(" "),
    );
  }

  return lines.join("\n");
}
