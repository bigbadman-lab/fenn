/**
 * Desk-operated Wall-only agent effect test (Stage 12.6 path, no X).
 *
 * Provenance (documented):
 * - Uses a reserved synthetic digit snowflake as x_perception_events.x_post_id so
 *   claim_x_perception_effect(p_x_post_id) can target only this row — no queue drain.
 * - Wall source_type remains locked to "x_agent" (allowed Stage 10.5 types).
 * - source_external_id / effect idempotency_key = `{snowflake}:wall`.
 * - No migration: reuses existing perception → judgement → authorization → effect chain.
 * - Reserved snowflake for test version v1: never used as a real X post id by FENN ops.
 */

import "server-only";

import { STAGE125_POLICY_VERSION } from "@/lib/agent/authority-config";
import {
  evaluateAuthorityDecision,
} from "@/lib/agent/authority-policy";
import { persistXPerceptionAuthorization } from "@/lib/agent/authority-persist";
import {
  claimXPerceptionEffect,
  completeXPerceptionEffect,
  failXPerceptionEffect,
} from "@/lib/agent/effect-persist";
import { validateWallEffectPayload } from "@/lib/agent/effect-payload";
import {
  stage12WallSourceExternalId,
  stage12WallWriteInput,
} from "@/lib/wall/stage12-tool-contract";
import { writeFennWallEntry } from "@/lib/wall/write";
import { WallError } from "@/lib/wall/errors";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Versioned server-controlled test identity. Bump for a fresh re-run. */
export const DESK_WALL_TEST_VERSION = 1 as const;

/**
 * Reserved synthetic X post id (digit snowflake shape).
 * Not obtained from X. Used only as a foreign-keyed isolation key for v1.
 */
export const DESK_WALL_TEST_X_POST_ID = "9000000000000000001" as const;

/** Author id for the synthetic seed perception (not a member wallet). */
const DESK_WALL_TEST_AUTHOR_X_USER_ID = "9000000000000000000";

/**
 * Fixed public inscription body — never taken from the browser.
 */
export const DESK_WALL_TEST_BODY =
  "THE WALL HEARD THE MACHINE.\n\nfirst live signal received.";

const SEED_PERCEPTION_BODY =
  "[desk wall test seed v1 — not an X mention; authority uses reserved synthetic id]";

export type DeskWallTestStatus = "created" | "already_present" | "failed";

export type DeskWallTestResult = {
  ok: boolean;
  status: DeskWallTestStatus;
  wallEntryId?: string;
  effectId?: string;
  testVersion: typeof DESK_WALL_TEST_VERSION;
  xAttempted: false;
  durationMs: number;
  errorCode?: string;
};

export type DeskWallTestLastState = {
  testVersion: typeof DESK_WALL_TEST_VERSION;
  status: "none" | "completed" | "failed" | "pending" | "processing";
  wallEntryId: string | null;
  effectId: string | null;
  completedAt: string | null;
  updatedAt: string | null;
};

export function deskWallTestSourceExternalId(): string {
  return stage12WallSourceExternalId(DESK_WALL_TEST_X_POST_ID);
}

export function deskWallTestIdempotencyKey(): string {
  return deskWallTestSourceExternalId();
}

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function logWallTest(fields: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      operation: "desk_agent_wall_test",
      xAttempted: false,
      testVersion: DESK_WALL_TEST_VERSION,
      ...fields,
    }),
  );
}

/**
 * Look up current Wall entry for this test provenance (if any).
 */
export async function findDeskWallTestEntry(
  admin?: SupabaseClient,
): Promise<{ id: string; body: string } | null> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("wall_entries")
    .select("id, body")
    .eq("source_type", "x_agent")
    .eq("source_external_id", deskWallTestSourceExternalId())
    .maybeSingle();
  if (error) {
    throw new Error(`desk_wall_test_lookup_failed`);
  }
  if (!data) return null;
  return { id: String(data.id), body: String(data.body) };
}

/**
 * Effect row for this test's unique idempotency key.
 */
export async function findDeskWallTestEffect(
  admin?: SupabaseClient,
): Promise<{
  id: string;
  status: string;
  externalResultId: string | null;
  completedAt: string | null;
  updatedAt: string | null;
} | null> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("x_perception_effects")
    .select("id, status, external_result_id, completed_at, updated_at")
    .eq("idempotency_key", deskWallTestIdempotencyKey())
    .maybeSingle();
  if (error) {
    throw new Error("desk_wall_test_effect_lookup_failed");
  }
  if (!data) return null;
  return {
    id: String(data.id),
    status: String(data.status),
    externalResultId:
      typeof data.external_result_id === "string"
        ? data.external_result_id
        : null,
    completedAt:
      typeof data.completed_at === "string" ? data.completed_at : null,
    updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
  };
}

export async function getDeskWallTestLastState(
  admin?: SupabaseClient,
): Promise<DeskWallTestLastState> {
  const db = admin ?? (await defaultAdmin());
  const [entry, effect] = await Promise.all([
    findDeskWallTestEntry(db),
    findDeskWallTestEffect(db),
  ]);

  if (effect && effect.status === "completed") {
    return {
      testVersion: DESK_WALL_TEST_VERSION,
      status: "completed",
      wallEntryId: entry?.id ?? effect.externalResultId ?? null,
      effectId: effect.id,
      completedAt: effect.completedAt ?? null,
      updatedAt: effect.updatedAt ?? null,
    };
  }

  if (entry) {
    return {
      testVersion: DESK_WALL_TEST_VERSION,
      status: "completed",
      wallEntryId: entry.id,
      effectId: effect?.id ?? null,
      completedAt: effect?.completedAt ?? null,
      updatedAt: effect?.updatedAt ?? null,
    };
  }

  if (effect && effect.status === "failed") {
    return {
      testVersion: DESK_WALL_TEST_VERSION,
      status: "failed",
      wallEntryId: null,
      effectId: effect.id,
      completedAt: null,
      updatedAt: effect.updatedAt,
    };
  }
  if (effect && effect.status === "processing") {
    return {
      testVersion: DESK_WALL_TEST_VERSION,
      status: "processing",
      wallEntryId: null,
      effectId: effect.id,
      completedAt: null,
      updatedAt: effect.updatedAt,
    };
  }
  if (effect && effect.status === "pending") {
    return {
      testVersion: DESK_WALL_TEST_VERSION,
      status: "pending",
      wallEntryId: null,
      effectId: effect.id,
      completedAt: null,
      updatedAt: effect.updatedAt,
    };
  }
  return {
    testVersion: DESK_WALL_TEST_VERSION,
    status: "none",
    wallEntryId: null,
    effectId: null,
    completedAt: null,
    updatedAt: null,
  };
}

/**
 * Ensure synthetic perception / finalised intention / wall-only pending effect exist.
 * Idempotent. Never creates reply_on_x.
 */
export async function ensureDeskWallTestScaffold(
  admin?: SupabaseClient,
): Promise<{
  perceptionEventId: string;
  judgementId: string;
  effectId: string | null;
  createdScaffold: boolean;
}> {
  const db = admin ?? (await defaultAdmin());
  let createdScaffold = false;

  const { data: existingEvent, error: eventError } = await db
    .from("x_perception_events")
    .select("id")
    .eq("x_post_id", DESK_WALL_TEST_X_POST_ID)
    .maybeSingle();

  if (eventError) {
    throw new Error("desk_wall_test_event_load_failed");
  }

  let event = existingEvent;

  if (!event) {
    const insert = await db
      .from("x_perception_events")
      .insert({
        x_post_id: DESK_WALL_TEST_X_POST_ID,
        perception_type: "mention",
        author_x_user_id: DESK_WALL_TEST_AUTHOR_X_USER_ID,
        author_username: "desk_wall_test",
        author_display_name: "Desk Wall Test",
        body: SEED_PERCEPTION_BODY,
        conversation_id: null,
        referenced_tweet_ids: [],
        x_created_at: new Date().toISOString(),
        status: "processed",
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insert.error || !insert.data) {
      // Race with concurrent operator click.
      const retry = await db
        .from("x_perception_events")
        .select("id")
        .eq("x_post_id", DESK_WALL_TEST_X_POST_ID)
        .maybeSingle();
      if (retry.error || !retry.data) {
        throw new Error("desk_wall_test_event_insert_failed");
      }
      event = retry.data;
    } else {
      event = insert.data;
      createdScaffold = true;
    }
  }

  const perceptionEventId = String(event.id);

  const { data: existingJudgement, error: judgementError } = await db
    .from("x_perception_judgements")
    .select("id")
    .eq("perception_event_id", perceptionEventId)
    .maybeSingle();

  if (judgementError) {
    throw new Error("desk_wall_test_judgement_load_failed");
  }

  let judgement = existingJudgement;

  if (!judgement) {
    const insert = await db
      .from("x_perception_judgements")
      .insert({
        perception_event_id: perceptionEventId,
        action: "write_to_wall",
        reason_code: "creative_world_action",
        engage: true,
        reply_text: null,
        wall_body: DESK_WALL_TEST_BODY,
        needs_live_state: [],
        identity_unverified: false,
        knowledge_available: true,
        model: "desk-wall-test",
        prompt_version: `desk-wall-test-v${DESK_WALL_TEST_VERSION}`,
        final_status: "finalized",
        live_state_available: false,
        live_state_succeeded: [],
        live_state_failed: [],
        finalized_at: new Date().toISOString(),
        final_action: "write_to_wall",
        final_reason_code: "creative_world_action",
        final_engage: true,
        final_reply_text: null,
        final_wall_body: DESK_WALL_TEST_BODY,
        final_identity_unverified: false,
        final_model: "desk-wall-test",
        final_prompt_version: `desk-wall-test-v${DESK_WALL_TEST_VERSION}`,
      })
      .select("id")
      .single();
    if (insert.error || !insert.data) {
      const retry = await db
        .from("x_perception_judgements")
        .select("id")
        .eq("perception_event_id", perceptionEventId)
        .maybeSingle();
      if (retry.error || !retry.data) {
        throw new Error("desk_wall_test_judgement_insert_failed");
      }
      judgement = retry.data;
    } else {
      judgement = insert.data;
      createdScaffold = true;
    }
  }

  const judgementId = String(judgement.id);

  const decision = evaluateAuthorityDecision({
    perceptionEventId,
    judgementId,
    xPostId: DESK_WALL_TEST_X_POST_ID,
    perceptionType: "mention",
    finalStatus: "finalized",
    finalAction: "write_to_wall",
    finalReplyText: null,
    finalWallBody: DESK_WALL_TEST_BODY,
  });

  if (decision.outcome !== "permitted" || decision.effects.length !== 1) {
    throw new Error("desk_wall_test_authority_denied");
  }
  if (decision.effects[0]?.type !== "write_to_wall") {
    throw new Error("desk_wall_test_not_wall_only");
  }
  // Defence: never allow reply effects through this path.
  if (decision.effects.some((e) => e.type === "reply_on_x")) {
    throw new Error("desk_wall_test_reply_forbidden");
  }

  await persistXPerceptionAuthorization(
    {
      perceptionEventId,
      judgementId,
      decision: {
        ...decision,
        policyVersion: STAGE125_POLICY_VERSION,
      },
    },
    { admin: db as never },
  );

  const effect = await findDeskWallTestEffect(db);

  return {
    perceptionEventId,
    judgementId,
    effectId: effect?.id ?? null,
    createdScaffold,
  };
}

/**
 * Run the Wall-only Desk test: scaffold → claim exactly this synthetic id → wall write.
 * Never imports or calls X reply client. Never drains the general effect queue.
 */
export async function runDeskAgentWallTest(options?: {
  admin?: SupabaseClient;
  actorId?: string;
}): Promise<DeskWallTestResult> {
  const started = Date.now();
  const db = options?.admin ?? (await defaultAdmin());
  const xAttempted = false as const;

  try {
    const existingEntry = await findDeskWallTestEntry(db);
    const existingEffect = await findDeskWallTestEffect(db);

    if (
      existingEntry &&
      existingEffect?.status === "completed"
    ) {
      const durationMs = Date.now() - started;
      logWallTest({
        status: "already_present",
        effectId: existingEffect.id,
        wallEntryId: existingEntry.id,
        durationMs,
        actorId: options?.actorId ?? null,
      });
      return {
        ok: true,
        status: "already_present",
        wallEntryId: existingEntry.id,
        effectId: existingEffect.id,
        testVersion: DESK_WALL_TEST_VERSION,
        xAttempted,
        durationMs,
      };
    }

    if (existingEntry && !existingEffect) {
      // Wall row exists (idempotent write) without completed effect — report present.
      const durationMs = Date.now() - started;
      logWallTest({
        status: "already_present",
        wallEntryId: existingEntry.id,
        durationMs,
        actorId: options?.actorId ?? null,
      });
      return {
        ok: true,
        status: "already_present",
        wallEntryId: existingEntry.id,
        testVersion: DESK_WALL_TEST_VERSION,
        xAttempted,
        durationMs,
      };
    }

    await ensureDeskWallTestScaffold(db);

    // Claim ONLY effects for this reserved synthetic x_post_id (never open queue).
    const claimed = await claimXPerceptionEffect(
      { xPostId: DESK_WALL_TEST_X_POST_ID },
      { admin: db as never },
    );

    if (!claimed) {
      // Effect already completed between checks, or nowhere to claim.
      const entryAfter = await findDeskWallTestEntry(db);
      const effectAfter = await findDeskWallTestEffect(db);
      const durationMs = Date.now() - started;
      if (entryAfter || effectAfter?.status === "completed") {
        logWallTest({
          status: "already_present",
          effectId: effectAfter?.id ?? null,
          wallEntryId: entryAfter?.id ?? effectAfter?.externalResultId ?? null,
          durationMs,
          actorId: options?.actorId ?? null,
        });
        return {
          ok: true,
          status: "already_present",
          wallEntryId: entryAfter?.id ?? effectAfter?.externalResultId ?? undefined,
          effectId: effectAfter?.id,
          testVersion: DESK_WALL_TEST_VERSION,
          xAttempted,
          durationMs,
        };
      }
      throw new Error("desk_wall_test_claim_empty");
    }

    if (claimed.effectType !== "write_to_wall") {
      await failXPerceptionEffect(
        {
          effectId: claimed.effectId,
          failureClass: "terminal",
          lastError: "desk_wall_test_reject_non_wall",
        },
        { admin: db as never },
      );
      throw new Error("desk_wall_test_non_wall_effect");
    }

    if (claimed.xPostId !== DESK_WALL_TEST_X_POST_ID) {
      await failXPerceptionEffect(
        {
          effectId: claimed.effectId,
          failureClass: "terminal",
          lastError: "desk_wall_test_x_post_id_mismatch",
        },
        { admin: db as never },
      );
      throw new Error("desk_wall_test_claim_mismatch");
    }

    if (claimed.idempotencyKey !== deskWallTestIdempotencyKey()) {
      await failXPerceptionEffect(
        {
          effectId: claimed.effectId,
          failureClass: "terminal",
          lastError: "desk_wall_test_idempotency_mismatch",
        },
        { admin: db as never },
      );
      throw new Error("desk_wall_test_idempotency_mismatch");
    }

    // Canonical Stage 12.6 wall validation + writeFennWallEntry (no X path).
    const payload = validateWallEffectPayload(
      claimed.payload,
      DESK_WALL_TEST_X_POST_ID,
    );
    // Re-lock body to the server constant if payload was ever tampered with offline.
    // Authority scaffold always uses DESK_WALL_TEST_BODY; reject divergence.
    if (payload.body !== DESK_WALL_TEST_BODY) {
      await failXPerceptionEffect(
        {
          effectId: claimed.effectId,
          failureClass: "terminal",
          lastError: "desk_wall_test_body_mismatch",
        },
        { admin: db as never },
      );
      throw new Error("desk_wall_test_body_mismatch");
    }

    const locked = stage12WallWriteInput({
      body: DESK_WALL_TEST_BODY,
      sourceExternalId: deskWallTestSourceExternalId(),
    });

    const wallResult = await writeFennWallEntry(
      {
        body: locked.body,
        sourceType: locked.sourceType,
        sourceExternalId: locked.sourceExternalId,
      },
      db,
    );

    await completeXPerceptionEffect(
      {
        effectId: claimed.effectId,
        externalResultId: wallResult.entry.id,
      },
      { admin: db as never },
    );

    const durationMs = Date.now() - started;
    const status: DeskWallTestStatus = wallResult.created
      ? "created"
      : "already_present";

    logWallTest({
      status,
      effectId: claimed.effectId,
      wallEntryId: wallResult.entry.id,
      durationMs,
      wallCreated: wallResult.created,
      actorId: options?.actorId ?? null,
    });

    return {
      ok: true,
      status,
      wallEntryId: wallResult.entry.id,
      effectId: claimed.effectId,
      testVersion: DESK_WALL_TEST_VERSION,
      xAttempted,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const errorCode =
      error instanceof WallError
        ? error.code
        : error instanceof Error
          ? error.message.slice(0, 80)
          : "desk_wall_test_failed";
    logWallTest({
      status: "failed",
      errorCode,
      durationMs,
      actorId: options?.actorId ?? null,
    });
    return {
      ok: false,
      status: "failed",
      testVersion: DESK_WALL_TEST_VERSION,
      xAttempted,
      durationMs,
      errorCode,
    };
  }
}
