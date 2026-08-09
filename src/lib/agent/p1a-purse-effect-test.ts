/**
 * Stage P1A controlled transfer_fenn effect test (operator-only).
 *
 * Proves: Stage 12 effect → claim/dispatch → Purse adapter → P0 settlement.
 * Does NOT call Purse directly from the CLI — always via executeOneXPerceptionEffect.
 *
 * Requires disposable-token rail env (FENN_PURSE_TEST_MODE=explicit_allow, etc).
 * Sets payload.executionRail = "p1a_test" so ordinary Stage 12 work never
 * silently substitutes a disposable token.
 */

import "server-only";

import {
  STAGE125_POLICY_VERSION,
  stage12TransferFennEffectIdempotencyKey,
} from "@/lib/agent/authority-config";
import { persistXPerceptionAuthorization } from "@/lib/agent/authority-persist";
import type { AuthorityDecision } from "@/lib/agent/authority-policy";
import {
  TRANSFER_FENN_P1A_TEST_RAIL,
  validateTransferFennEffectPayload,
} from "@/lib/agent/effect-payload";
import { executeOneXPerceptionEffect } from "@/lib/agent/stage126-execute";
import { STAGE126_ECONOMIC_EFFECT_TYPES } from "@/lib/agent/execute-config";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reserved synthetic digit snowflake prefix for P1A isolation.
 * Deterministic 19-digit id derived from operation label.
 */
export function p1aPurseTestXPostId(operationLabel: string): string {
  const label = operationLabel.trim();
  if (!label) throw new Error("operationLabel required");
  const digest = createHash("sha256").update(`p1a:${label}`).digest("hex");
  // 9002 + 15 hex digits as decimal digits (safe snowflake shape)
  const n = Number.parseInt(digest.slice(0, 12), 16) % 1e15;
  return `9002${String(n).padStart(15, "0")}`;
}

const AUTHOR_X_USER_ID = "9000000000000000000";

export type P1aPurseEffectTestResult = {
  ok: boolean;
  status:
    | "completed"
    | "failed"
    | "already_completed"
    | "dry_run"
    | "empty"
    | "scaffold_failed";
  effectId?: string;
  xPostId?: string;
  operationLabel: string;
  externalResultId?: string;
  failureClass?: string;
  errorCode?: string;
  durationMs: number;
  dryRunPreview?: string;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function p1aDecision(input: {
  xPostId: string;
  recipientAddress: string;
  operationLabel: string;
}): AuthorityDecision {
  const payload = {
    recipientAddress: input.recipientAddress,
    amountFormatted: "1" as const,
    executionRail: TRANSFER_FENN_P1A_TEST_RAIL,
  };
  // Validate before persist (deterministic authority).
  validateTransferFennEffectPayload(payload);

  return {
    outcome: "permitted",
    policyCode: "permitted_transfer_p1a",
    policyVersion: STAGE125_POLICY_VERSION,
    finalAction: "do_nothing",
    sourceXPostId: input.xPostId,
    effects: [
      {
        type: "transfer_fenn",
        idempotencyKey: stage12TransferFennEffectIdempotencyKey(
          input.operationLabel,
        ),
        payload,
      },
    ],
    policyOutcome: "reply_only",
  };
}

/**
 * Ensure synthetic perception / judgement / pending transfer_fenn effect exist.
 */
export async function ensureP1aPurseTransferScaffold(input: {
  recipientAddress: string;
  operationLabel: string;
  admin?: SupabaseClient;
}): Promise<{
  perceptionEventId: string;
  judgementId: string;
  effectId: string | null;
  xPostId: string;
}> {
  const db = input.admin ?? (await defaultAdmin());
  const xPostId = p1aPurseTestXPostId(input.operationLabel);
  const decision = p1aDecision({
    xPostId,
    recipientAddress: input.recipientAddress,
    operationLabel: input.operationLabel,
  });

  const { data: existingEvent, error: eventError } = await db
    .from("x_perception_events")
    .select("id")
    .eq("x_post_id", xPostId)
    .maybeSingle();
  if (eventError) throw new Error("p1a_event_load_failed");

  let event = existingEvent;
  if (!event) {
    const insert = await db
      .from("x_perception_events")
      .insert({
        x_post_id: xPostId,
        perception_type: "mention",
        author_x_user_id: AUTHOR_X_USER_ID,
        author_username: "p1a_purse_test",
        author_display_name: "P1A Purse Test",
        body: `[p1a transfer_fenn seed — not an X mention; label=${input.operationLabel}]`,
        conversation_id: null,
        referenced_tweet_ids: [],
        x_created_at: new Date().toISOString(),
        status: "processed",
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insert.error || !insert.data) {
      const retry = await db
        .from("x_perception_events")
        .select("id")
        .eq("x_post_id", xPostId)
        .maybeSingle();
      if (retry.error || !retry.data) throw new Error("p1a_event_insert_failed");
      event = retry.data;
    } else {
      event = insert.data;
    }
  }

  const perceptionEventId = String(event.id);

  const { data: existingJudgement, error: jErr } = await db
    .from("x_perception_judgements")
    .select("id")
    .eq("perception_event_id", perceptionEventId)
    .maybeSingle();
  if (jErr) throw new Error("p1a_judgement_load_failed");

  let judgement = existingJudgement;
  if (!judgement) {
    const insert = await db
      .from("x_perception_judgements")
      .insert({
        perception_event_id: perceptionEventId,
        action: "do_nothing",
        reason_code: "no_response_warranted",
        engage: false,
        reply_text: null,
        wall_body: null,
        needs_live_state: [],
        identity_unverified: false,
        knowledge_available: true,
        model: "p1a-purse-effect-test",
        prompt_version: "p1a-v1",
        final_status: "finalized",
        live_state_available: false,
        live_state_succeeded: [],
        live_state_failed: [],
        finalized_at: new Date().toISOString(),
        final_action: "do_nothing",
        final_reason_code: "no_response_warranted",
        final_engage: false,
        final_reply_text: null,
        final_wall_body: null,
        final_identity_unverified: false,
        final_model: "p1a-purse-effect-test",
        final_prompt_version: "p1a-v1",
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
        throw new Error("p1a_judgement_insert_failed");
      }
      judgement = retry.data;
    } else {
      judgement = insert.data;
    }
  }

  const judgementId = String(judgement.id);

  await persistXPerceptionAuthorization(
    {
      perceptionEventId,
      judgementId,
      decision,
    },
    { admin: db as never },
  );

  const { data: effect } = await db
    .from("x_perception_effects")
    .select("id")
    .eq(
      "idempotency_key",
      stage12TransferFennEffectIdempotencyKey(input.operationLabel),
    )
    .maybeSingle();

  return {
    perceptionEventId,
    judgementId,
    effectId: effect?.id ? String(effect.id) : null,
    xPostId,
  };
}

/**
 * Scaffold + execute one P1A transfer_fenn effect through Stage 12.6 dispatch.
 */
export async function runP1aPurseEffectTest(input: {
  recipientAddress: string;
  operationLabel: string;
  dryRun?: boolean;
  admin?: SupabaseClient;
}): Promise<P1aPurseEffectTestResult> {
  const started = Date.now();
  const operationLabel = input.operationLabel.trim();

  try {
    const scaffold = await ensureP1aPurseTransferScaffold({
      recipientAddress: input.recipientAddress,
      operationLabel,
      admin: input.admin,
    });

    if (input.dryRun) {
      const one = await executeOneXPerceptionEffect(
        {
          xPostId: scaffold.xPostId,
          dryRun: true,
          effectTypes: STAGE126_ECONOMIC_EFFECT_TYPES,
        },
        { admin: input.admin as never },
      );
      return {
        ok: one.status === "dry_run" || one.status === "empty",
        status: one.status === "dry_run" ? "dry_run" : one.status === "empty" ? "empty" : "failed",
        effectId: one.effectId ?? scaffold.effectId ?? undefined,
        xPostId: scaffold.xPostId,
        operationLabel,
        dryRunPreview: one.dryRunPreview,
        durationMs: Date.now() - started,
        errorCode: one.errorCode,
      };
    }

    // Live path: claim+dispatch via Stage 12.6 (economic scope — operator harness).
    const one = await executeOneXPerceptionEffect(
      {
        xPostId: scaffold.xPostId,
        dryRun: false,
        effectTypes: STAGE126_ECONOMIC_EFFECT_TYPES,
      },
      { admin: input.admin as never },
    );

    if (one.status === "completed") {
      return {
        ok: true,
        status:
          one.externalResultId && scaffold.effectId
            ? "completed"
            : "completed",
        effectId: one.effectId,
        xPostId: scaffold.xPostId,
        operationLabel,
        externalResultId: one.externalResultId,
        durationMs: Date.now() - started,
      };
    }

    if (one.status === "empty") {
      // Effect may already be completed — treat as already_completed when effect done.
      const db = input.admin ?? (await defaultAdmin());
      const { data: effect } = await db
        .from("x_perception_effects")
        .select("id, status, external_result_id")
        .eq(
          "idempotency_key",
          stage12TransferFennEffectIdempotencyKey(operationLabel),
        )
        .maybeSingle();
      if (effect && effect.status === "completed") {
        return {
          ok: true,
          status: "already_completed",
          effectId: String(effect.id),
          xPostId: scaffold.xPostId,
          operationLabel,
          externalResultId:
            typeof effect.external_result_id === "string"
              ? effect.external_result_id
              : undefined,
          durationMs: Date.now() - started,
        };
      }
      return {
        ok: false,
        status: "empty",
        xPostId: scaffold.xPostId,
        operationLabel,
        durationMs: Date.now() - started,
        errorCode: "p1a_claim_empty",
      };
    }

    return {
      ok: false,
      status: "failed",
      effectId: one.effectId,
      xPostId: scaffold.xPostId,
      operationLabel,
      failureClass: one.failureClass,
      errorCode: one.errorCode,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: "scaffold_failed",
      operationLabel,
      durationMs: Date.now() - started,
      errorCode:
        error instanceof Error ? error.message.slice(0, 80) : "p1a_failed",
    };
  }
}
