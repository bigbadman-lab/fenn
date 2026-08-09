/**
 * Stage P1A.1 controlled burn_fenn effect test (operator-only).
 *
 * Proves: Stage 12 effect → claim/dispatch → Purse burn adapter → dead-address
 * settlement. Does NOT call Purse directly from the CLI.
 *
 * No recipient argument — burn destination is FENN_DEAD_ADDRESS in server code.
 */

import "server-only";

import {
  STAGE125_POLICY_VERSION,
  stage12BurnFennEffectIdempotencyKey,
} from "@/lib/agent/authority-config";
import { persistXPerceptionAuthorization } from "@/lib/agent/authority-persist";
import type { AuthorityDecision } from "@/lib/agent/authority-policy";
import {
  TRANSFER_FENN_P1A_TEST_RAIL,
  validateBurnFennEffectPayload,
} from "@/lib/agent/effect-payload";
import { executeOneXPerceptionEffect } from "@/lib/agent/stage126-execute";
import { STAGE126_ECONOMIC_EFFECT_TYPES } from "@/lib/agent/execute-config";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reserved synthetic digit snowflake prefix for P1A.1 burn isolation.
 * Distinct from transfer labels so the same operation-label can exist for both.
 */
export function p1aPurseBurnTestXPostId(operationLabel: string): string {
  const label = operationLabel.trim();
  if (!label) throw new Error("operationLabel required");
  const digest = createHash("sha256").update(`p1a-burn:${label}`).digest("hex");
  const n = Number.parseInt(digest.slice(0, 12), 16) % 1e15;
  return `9003${String(n).padStart(15, "0")}`;
}

const AUTHOR_X_USER_ID = "9000000000000000001";

export type P1aPurseBurnTestResult = {
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

function p1aBurnDecision(input: {
  xPostId: string;
  operationLabel: string;
}): AuthorityDecision {
  const payload = {
    amountFormatted: "1" as const,
    executionRail: TRANSFER_FENN_P1A_TEST_RAIL,
  };
  validateBurnFennEffectPayload(payload);

  return {
    outcome: "permitted",
    policyCode: "permitted_burn_p1a",
    policyVersion: STAGE125_POLICY_VERSION,
    finalAction: "do_nothing",
    sourceXPostId: input.xPostId,
    effects: [
      {
        type: "burn_fenn",
        idempotencyKey: stage12BurnFennEffectIdempotencyKey(
          input.operationLabel,
        ),
        payload,
      },
    ],
    policyOutcome: "reply_only",
  };
}

export async function ensureP1aPurseBurnScaffold(input: {
  operationLabel: string;
  admin?: SupabaseClient;
}): Promise<{
  perceptionEventId: string;
  judgementId: string;
  effectId: string | null;
  xPostId: string;
}> {
  const db = input.admin ?? (await defaultAdmin());
  const xPostId = p1aPurseBurnTestXPostId(input.operationLabel);
  const decision = p1aBurnDecision({
    xPostId,
    operationLabel: input.operationLabel,
  });

  const { data: existingEvent, error: eventError } = await db
    .from("x_perception_events")
    .select("id")
    .eq("x_post_id", xPostId)
    .maybeSingle();
  if (eventError) throw new Error("p1a_burn_event_load_failed");

  let event = existingEvent;
  if (!event) {
    const insert = await db
      .from("x_perception_events")
      .insert({
        x_post_id: xPostId,
        perception_type: "mention",
        author_x_user_id: AUTHOR_X_USER_ID,
        author_username: "p1a_burn_test",
        author_display_name: "P1A Burn Test",
        body: `[p1a burn_fenn seed — not an X mention; label=${input.operationLabel}]`,
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
      if (retry.error || !retry.data) throw new Error("p1a_burn_event_insert_failed");
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
  if (jErr) throw new Error("p1a_burn_judgement_load_failed");

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
        model: "p1a-purse-burn-test",
        prompt_version: "p1a1-v1",
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
        final_model: "p1a-purse-burn-test",
        final_prompt_version: "p1a1-v1",
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
        throw new Error("p1a_burn_judgement_insert_failed");
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
      stage12BurnFennEffectIdempotencyKey(input.operationLabel),
    )
    .maybeSingle();

  return {
    perceptionEventId,
    judgementId,
    effectId: effect?.id ? String(effect.id) : null,
    xPostId,
  };
}

export async function runP1aPurseBurnTest(input: {
  operationLabel: string;
  dryRun?: boolean;
  admin?: SupabaseClient;
}): Promise<P1aPurseBurnTestResult> {
  const started = Date.now();
  const operationLabel = input.operationLabel.trim();

  try {
    const scaffold = await ensureP1aPurseBurnScaffold({
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
        status:
          one.status === "dry_run"
            ? "dry_run"
            : one.status === "empty"
              ? "empty"
              : "failed",
        effectId: one.effectId ?? scaffold.effectId ?? undefined,
        xPostId: scaffold.xPostId,
        operationLabel,
        dryRunPreview: one.dryRunPreview,
        durationMs: Date.now() - started,
        errorCode: one.errorCode,
      };
    }

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
        status: "completed",
        effectId: one.effectId,
        xPostId: scaffold.xPostId,
        operationLabel,
        externalResultId: one.externalResultId,
        durationMs: Date.now() - started,
      };
    }

    if (one.status === "empty") {
      const db = input.admin ?? (await defaultAdmin());
      const { data: effect } = await db
        .from("x_perception_effects")
        .select("id, status, external_result_id")
        .eq(
          "idempotency_key",
          stage12BurnFennEffectIdempotencyKey(operationLabel),
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
        errorCode: "p1a_burn_claim_empty",
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
        error instanceof Error ? error.message.slice(0, 80) : "p1a_burn_failed",
    };
  }
}
