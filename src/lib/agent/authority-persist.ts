import "server-only";

import { AuthorityError } from "@/lib/agent/authority-errors";
import type { AuthorityDecision, AuthorityEffectPlan } from "@/lib/agent/authority-policy";

export type ClaimedAuthorityJudgement = {
  perceptionEventId: string;
  judgementId: string;
  xPostId: string;
  perceptionType: string;
  authorXUserId: string;
  body: string;
  finalStatus: string;
  finalAction: string | null;
  finalReasonCode: string | null;
  finalEngage: boolean;
  finalReplyText: string | null;
  finalWallBody: string | null;
  finalIdentityUnverified: boolean;
  needsLiveState: string[];
  liveStateAvailable: boolean;
  alreadyAuthorised: boolean;
  /** Stage 3 structured Wall candidate from final judge (nullable). */
  finalWallCandidate: unknown | null;
};

export type PersistAuthorizationResult = {
  created: boolean;
  authorizationId: string;
  outcome: string;
  policyCode: string;
  effectsCreated: number;
};

type AdminLike = {
  from: (table: string) => unknown;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function getAdmin(): Promise<AdminLike> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as AdminLike;
}

export async function claimXPerceptionForAuthority(
  deps: { admin?: AdminLike } = {},
): Promise<ClaimedAuthorityJudgement | null> {
  const admin = deps.admin ?? (await getAdmin());
  const { data, error } = await admin.rpc("claim_x_perception_for_authority");

  if (error) {
    throw new AuthorityError(
      "authority_claim_failed",
      `claim failed: ${error.message}`,
      500,
    );
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) return null;

  const row = rows[0] as Record<string, unknown>;
  if (
    typeof row.perception_event_id !== "string" ||
    typeof row.judgement_id !== "string" ||
    typeof row.x_post_id !== "string"
  ) {
    throw new AuthorityError(
      "authority_claim_failed",
      "unexpected claim payload",
      500,
    );
  }

  return {
    perceptionEventId: row.perception_event_id,
    judgementId: row.judgement_id,
    xPostId: row.x_post_id,
    perceptionType: String(row.perception_type ?? "mention"),
    authorXUserId: String(row.author_x_user_id ?? ""),
    body: String(row.body ?? ""),
    finalStatus: String(row.final_status ?? ""),
    finalAction:
      typeof row.final_action === "string" ? row.final_action : null,
    finalReasonCode:
      typeof row.final_reason_code === "string" ? row.final_reason_code : null,
    finalEngage: Boolean(row.final_engage),
    finalReplyText:
      typeof row.final_reply_text === "string" ? row.final_reply_text : null,
    finalWallBody:
      typeof row.final_wall_body === "string" ? row.final_wall_body : null,
    finalIdentityUnverified: Boolean(row.final_identity_unverified),
    needsLiveState: Array.isArray(row.needs_live_state)
      ? (row.needs_live_state as string[])
      : [],
    liveStateAvailable: Boolean(row.live_state_available),
    alreadyAuthorised: Boolean(row.already_authorised),
    finalWallCandidate:
      row.final_wall_candidate != null ? row.final_wall_candidate : null,
  };
}

function effectsToJson(effects: AuthorityEffectPlan[]): unknown[] {
  return effects.map((e) => ({
    type: e.type,
    idempotency_key: e.idempotencyKey,
    payload: e.payload,
  }));
}

export async function persistXPerceptionAuthorization(
  input: {
    perceptionEventId: string;
    judgementId: string;
    decision: AuthorityDecision;
  },
  deps: { admin?: AdminLike } = {},
): Promise<PersistAuthorizationResult> {
  const admin = deps.admin ?? (await getAdmin());
  const { decision } = input;

  const { data, error } = await admin.rpc("persist_x_perception_authorization", {
    p_perception_event_id: input.perceptionEventId,
    p_judgement_id: input.judgementId,
    p_outcome: decision.outcome,
    p_policy_code: decision.policyCode,
    p_policy_version: decision.policyVersion,
    p_final_action: decision.finalAction,
    p_source_x_post_id: decision.sourceXPostId,
    p_effects: effectsToJson(decision.effects),
  });

  if (error) {
    throw new AuthorityError(
      "authority_persist_failed",
      `persist failed: ${error.message}`,
      500,
    );
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = rows[0] as Record<string, unknown> | undefined;
  if (
    !row ||
    typeof row.created !== "boolean" ||
    typeof row.authorization_id !== "string" ||
    typeof row.outcome !== "string" ||
    typeof row.policy_code !== "string" ||
    typeof row.effects_created !== "number"
  ) {
    throw new AuthorityError(
      "authority_persist_failed",
      "unexpected persist payload",
      500,
    );
  }

  return {
    created: row.created,
    authorizationId: row.authorization_id,
    outcome: row.outcome,
    policyCode: row.policy_code,
    effectsCreated: row.effects_created,
  };
}

export type AuthorityInspection = {
  authorizationId: string;
  outcome: string;
  policyCode: string;
  policyVersion: string;
  finalAction: string;
  sourceXPostId: string;
  createdAt: string;
  effects: Array<{
    id: string;
    effectType: string;
    idempotencyKey: string;
    status: string;
    attemptCount: number;
    externalResultId: string | null;
    failureClass: string | null;
    lastError: string | null;
    completedAt: string | null;
    payload: Record<string, unknown>;
  }>;
};

export async function inspectAuthorizationByXPostId(
  xPostId: string,
  deps: { admin?: AdminLike } = {},
): Promise<AuthorityInspection | null> {
  const admin = deps.admin ?? (await getAdmin());
  const trimmed = xPostId.trim();
  if (!trimmed) {
    throw new AuthorityError("authority_not_found", "x_post_id required", 400);
  }

  const eventsTable = admin.from("x_perception_events") as {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const { data: event, error: eventError } = await eventsTable
    .select("id")
    .eq("x_post_id", trimmed)
    .maybeSingle();

  if (eventError) {
    throw new AuthorityError(
      "authority_persist_failed",
      eventError.message,
      500,
    );
  }
  if (!event) return null;

  const authTable = admin.from("x_perception_authorizations") as {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const { data: auth, error: authError } = await authTable
    .select(
      "id, outcome, policy_code, policy_version, final_action, source_x_post_id, created_at",
    )
    .eq("perception_event_id", event.id)
    .maybeSingle();

  if (authError) {
    throw new AuthorityError(
      "authority_persist_failed",
      authError.message,
      500,
    );
  }
  if (!auth) return null;

  const effectsTable = admin.from("x_perception_effects") as {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean },
        ) => Promise<{
          data: Record<string, unknown>[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const { data: effects, error: effectsError } = await effectsTable
    .select(
      "id, effect_type, idempotency_key, status, attempt_count, external_result_id, failure_class, last_error, completed_at, payload",
    )
    .eq("authorization_id", String(auth.id))
    .order("created_at", { ascending: true });

  if (effectsError) {
    throw new AuthorityError(
      "authority_persist_failed",
      effectsError.message,
      500,
    );
  }

  return {
    authorizationId: String(auth.id),
    outcome: String(auth.outcome),
    policyCode: String(auth.policy_code),
    policyVersion: String(auth.policy_version),
    finalAction: String(auth.final_action),
    sourceXPostId: String(auth.source_x_post_id),
    createdAt: String(auth.created_at),
    effects: (effects ?? []).map((e) => ({
      id: String(e.id),
      effectType: String(e.effect_type),
      idempotencyKey: String(e.idempotency_key),
      status: String(e.status),
      attemptCount: Number(e.attempt_count ?? 0),
      externalResultId:
        typeof e.external_result_id === "string" ? e.external_result_id : null,
      failureClass:
        typeof e.failure_class === "string" ? e.failure_class : null,
      lastError: typeof e.last_error === "string" ? e.last_error : null,
      completedAt:
        typeof e.completed_at === "string" ? e.completed_at : null,
      payload:
        e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
          ? (e.payload as Record<string, unknown>)
          : {},
    })),
  };
}
