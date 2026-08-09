import "server-only";

import type { Stage126FailureClass } from "@/lib/agent/execute-config";
import { STAGE126_SPEECH_EFFECT_TYPES } from "@/lib/agent/execute-config";
import { ExecuteError } from "@/lib/agent/execute-errors";

export type ClaimedEffect = {
  effectId: string;
  authorizationId: string;
  perceptionEventId: string;
  effectType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  status: string;
  attemptCount: number;
  xPostId: string;
  /** Effect row creation time (UTC). Used for pre-activation law. */
  createdAt: string | null;
};

export type PendingEffectListItem = {
  effectId: string;
  effectType: string;
  idempotencyKey: string;
  status: string;
  failureClass: string | null;
  attemptCount: number;
  xPostId: string;
  createdAt: string;
  payloadPreview: string | null;
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

/**
 * Normalize claim type filter. Empty / all-invalid → empty array (claim nothing).
 */
export function normalizeEffectTypeFilter(
  effectTypes: readonly string[] | undefined | null,
): string[] {
  if (!effectTypes || effectTypes.length === 0) return [];
  const allowed = new Set([
    "reply_on_x",
    "write_to_wall",
    "transfer_fenn",
    "burn_fenn",
  ]);
  const out: string[] = [];
  for (const raw of effectTypes) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (allowed.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Claim one pending/retryable effect among allowed types only.
 * Requires a non-empty type filter — empty filter claims nothing (fail closed).
 */
export async function claimXPerceptionEffect(
  options: {
    xPostId?: string;
    /** Required for safe claiming. Empty/missing → no claim. */
    effectTypes?: readonly string[];
  } = {},
  deps: { admin?: AdminLike } = {},
): Promise<ClaimedEffect | null> {
  const types = normalizeEffectTypeFilter(options.effectTypes);
  if (types.length === 0) {
    return null;
  }

  const admin = deps.admin ?? (await getAdmin());
  const { data, error } = await admin.rpc("claim_x_perception_effect", {
    p_effect_types: types,
    p_x_post_id: options.xPostId?.trim() || null,
  });

  if (error) {
    throw new ExecuteError(
      "execute_claim_failed",
      `claim failed: ${error.message}`,
      500,
    );
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) return null;

  const row = rows[0] as Record<string, unknown>;
  if (
    typeof row.effect_id !== "string" ||
    typeof row.effect_type !== "string" ||
    typeof row.x_post_id !== "string"
  ) {
    throw new ExecuteError(
      "execute_claim_failed",
      "unexpected claim payload",
      500,
    );
  }

  // Defense in depth: never return a type outside the requested filter.
  if (!types.includes(row.effect_type)) {
    throw new ExecuteError(
      "execute_claim_failed",
      "claim returned effect type outside requested filter",
      500,
    );
  }

  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};

  const createdAtRaw = row.effect_created_at ?? row.created_at;
  const createdAt =
    typeof createdAtRaw === "string" && createdAtRaw.trim()
      ? createdAtRaw
      : null;

  return {
    effectId: row.effect_id,
    authorizationId: String(row.authorization_id),
    perceptionEventId: String(row.perception_event_id),
    effectType: row.effect_type,
    idempotencyKey: String(row.idempotency_key),
    payload,
    status: String(row.status),
    attemptCount: Number(row.attempt_count ?? 0),
    xPostId: row.x_post_id,
    createdAt,
  };
}

export async function completeXPerceptionEffect(
  input: { effectId: string; externalResultId: string },
  deps: { admin?: AdminLike } = {},
): Promise<void> {
  const admin = deps.admin ?? (await getAdmin());
  const { data, error } = await admin.rpc("complete_x_perception_effect", {
    p_effect_id: input.effectId,
    p_external_result_id: input.externalResultId,
  });

  if (error) {
    throw new ExecuteError(
      "execute_persist_failed",
      `complete failed: ${error.message}`,
      500,
    );
  }
  if (data !== true) {
    throw new ExecuteError(
      "execute_persist_failed",
      "complete did not update processing effect",
      500,
    );
  }
}

export async function failXPerceptionEffect(
  input: {
    effectId: string;
    failureClass: Stage126FailureClass;
    lastError: string;
  },
  deps: { admin?: AdminLike } = {},
): Promise<void> {
  const admin = deps.admin ?? (await getAdmin());
  const { data, error } = await admin.rpc("fail_x_perception_effect", {
    p_effect_id: input.effectId,
    p_failure_class: input.failureClass,
    p_last_error: input.lastError.slice(0, 500),
  });

  if (error) {
    throw new ExecuteError(
      "execute_persist_failed",
      `fail persist failed: ${error.message}`,
      500,
    );
  }
  if (data !== true) {
    throw new ExecuteError(
      "execute_persist_failed",
      "fail did not update processing effect",
      500,
    );
  }
}

export async function listPendingXPerceptionEffects(
  limit = 20,
  deps: {
    admin?: AdminLike;
    effectTypes?: readonly string[];
  } = {},
): Promise<PendingEffectListItem[]> {
  const admin = deps.admin ?? (await getAdmin());
  const types = normalizeEffectTypeFilter(deps.effectTypes);
  const { data, error } = await admin.rpc("list_pending_x_perception_effects", {
    p_limit: limit,
    ...(types.length > 0 ? { p_effect_types: types } : {}),
  });

  if (error) {
    throw new ExecuteError(
      "execute_claim_failed",
      `list pending failed: ${error.message}`,
      500,
    );
  }

  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      effectId: String(r.effect_id),
      effectType: String(r.effect_type),
      idempotencyKey: String(r.idempotency_key),
      status: String(r.status),
      failureClass:
        typeof r.failure_class === "string" ? r.failure_class : null,
      attemptCount: Number(r.attempt_count ?? 0),
      xPostId: String(r.x_post_id),
      createdAt: String(r.created_at),
      payloadPreview:
        typeof r.payload_preview === "string" ? r.payload_preview : null,
    };
  });
}

/** Default claim filter for production X Agent / agent:execute-x (speech only). */
export function defaultSpeechClaimEffectTypes(): string[] {
  return [...STAGE126_SPEECH_EFFECT_TYPES];
}
