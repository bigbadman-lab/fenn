/**
 * Stage P1B controlled economic-judgement harness (operator-only).
 *
 * Runs: synthetic perception → model or injected intention → authority
 * with explicit test-rail economic context → optional Stage 12.6 execute.
 *
 * Ordinary live X traffic never uses this path's disposable rail.
 */

import "server-only";

import {
  STAGE125_POLICY_VERSION,
} from "@/lib/agent/authority-config";
import { persistXPerceptionAuthorization } from "@/lib/agent/authority-persist";
import {
  evaluateAuthorityDecision,
  type AuthorityDecision,
} from "@/lib/agent/authority-policy";
import {
  economicIntentToJson,
  normalizeModelEconomicAction,
  type FinalEconomicIntent,
} from "@/lib/agent/economic-intent";
import type { PurseEconomicState } from "@/lib/agent/purse-economic-context";
import { executeOneXPerceptionEffect } from "@/lib/agent/stage126-execute";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";

export function p1bEconomicTestXPostId(operationLabel: string): string {
  const label = operationLabel.trim();
  if (!label) throw new Error("operationLabel required");
  const digest = createHash("sha256").update(`p1b:${label}`).digest("hex");
  const n = Number.parseInt(digest.slice(0, 12), 16) % 1e15;
  return `9004${String(n).padStart(15, "0")}`;
}

const AUTHOR_X_USER_ID = "9000000000000000002";

export type P1bEconomicJudgementResult = {
  ok: boolean;
  status:
    | "dry_run"
    | "authorised"
    | "executed"
    | "failed"
    | "scaffold_failed";
  operationLabel: string;
  xPostId?: string;
  economicIntent?: FinalEconomicIntent;
  authorityOutcome?: string;
  policyCode?: string;
  effectTypes?: string[];
  externalResultId?: string;
  economicFollowupPreview?: string;
  errorCode?: string;
  durationMs: number;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function harnessPurseState(overrides?: Partial<PurseEconomicState>): PurseEconomicState {
  return {
    purseAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    isEnabled: true,
    environment: "p1b_test_harness",
    officialFennAvailable: false,
    officialBalanceFormatted: null,
    testBalanceFormatted: "10",
    remainingBalanceFormatted: "10",
    confirmedTransferCount: 0,
    confirmedBurnCount: 0,
    recentActions: [],
    economicExecutionEnabled: true,
    deadAddress: FENN_DEAD_ADDRESS,
    testRailExplicitlyActive: true,
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Authority-only evaluation for tests (no DB for decision).
 */
export function evaluateP1bEconomicAuthority(input: {
  perceptionEventId: string;
  judgementId?: string;
  xPostId: string;
  speechAction?: "reply_on_x" | "do_nothing" | "reply_and_write_to_wall";
  replyText?: string | null;
  reasonCode?: string;
  economicIntent: FinalEconomicIntent | unknown;
  trustedWallet?: string | null;
  purseState?: PurseEconomicState | null;
}): AuthorityDecision {
  return evaluateAuthorityDecision({
    perceptionEventId: input.perceptionEventId,
    judgementId: input.judgementId ?? "judgement-p1b",
    xPostId: input.xPostId,
    perceptionType: "mention",
    finalStatus: "finalized",
    finalAction: input.speechAction ?? "reply_on_x",
    finalReplyText:
      input.speechAction === "do_nothing"
        ? null
        : (input.replyText ?? "Heard."),
    finalWallBody: null,
    finalReasonCode: input.reasonCode ?? "answered_from_public_knowledge",
    finalEconomicIntent: economicIntentToJson(
      typeof input.economicIntent === "object" &&
        input.economicIntent &&
        "type" in (input.economicIntent as object)
        ? normalizeModelEconomicAction(input.economicIntent)
        : normalizeModelEconomicAction(input.economicIntent),
    ),
    economicContext: {
      harnessBoundWallet: input.trustedWallet ?? null,
      executionRail: "p1a_test",
      purseState: input.purseState ?? harnessPurseState(),
      sufficientBalance: true,
    },
  });
}

/**
 * Scaffold event + judgement + optional economic authority + optional execute.
 */
export async function runP1bEconomicJudgementTest(input: {
  operationLabel: string;
  text: string;
  /** Inject model intention without live OpenAI. */
  economicIntent?: FinalEconomicIntent;
  trustedWallet?: string | null;
  replyText?: string;
  dryRun?: boolean;
  execute?: boolean;
  admin?: SupabaseClient;
}): Promise<P1bEconomicJudgementResult> {
  const started = Date.now();
  const operationLabel = input.operationLabel.trim();
  const xPostId = p1bEconomicTestXPostId(operationLabel);
  const economicIntent = input.economicIntent ?? { type: "NONE" as const };

  try {
    const db = input.admin ?? (await defaultAdmin());

    const { data: existingEvent } = await db
      .from("x_perception_events")
      .select("id")
      .eq("x_post_id", xPostId)
      .maybeSingle();

    let eventId: string;
    if (existingEvent?.id) {
      eventId = String(existingEvent.id);
    } else {
      const insert = await db
        .from("x_perception_events")
        .insert({
          x_post_id: xPostId,
          perception_type: "mention",
          author_x_user_id: AUTHOR_X_USER_ID,
          author_username: "p1b_econ_test",
          author_display_name: "P1B Economic Test",
          body: input.text.slice(0, 2000),
          conversation_id: null,
          referenced_tweet_ids: [],
          x_created_at: new Date().toISOString(),
          status: "processed",
          processed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insert.error || !insert.data) {
        throw new Error("p1b_event_insert_failed");
      }
      eventId = String(insert.data.id);
    }

    const { data: existingJudgement } = await db
      .from("x_perception_judgements")
      .select("id, final_status")
      .eq("perception_event_id", eventId)
      .maybeSingle();

    let judgementId: string;
    if (existingJudgement?.id) {
      judgementId = String(existingJudgement.id);
      // Ensure finalized for authority reuse.
      if (existingJudgement.final_status !== "finalized") {
        await db
          .from("x_perception_judgements")
          .update({
            final_status: "finalized",
            final_action: "reply_on_x",
            final_reason_code: "answered_from_public_knowledge",
            final_engage: true,
            final_reply_text: input.replyText ?? "Noted.",
            final_wall_body: null,
            final_identity_unverified: false,
            final_model: "p1b-harness",
            final_prompt_version: "p1b-v1",
            final_economic_intent: economicIntentToJson(economicIntent),
            finalized_at: new Date().toISOString(),
            live_state_available: true,
          })
          .eq("id", judgementId);
      }
    } else {
      const insert = await db
        .from("x_perception_judgements")
        .insert({
          perception_event_id: eventId,
          action: "reply_on_x",
          reason_code: "answered_from_public_knowledge",
          engage: true,
          reply_text: input.replyText ?? "Noted.",
          wall_body: null,
          needs_live_state: [],
          identity_unverified: false,
          knowledge_available: true,
          model: "p1b-harness",
          prompt_version: "p1b-v1",
          final_status: "finalized",
          live_state_available: true,
          live_state_succeeded: [],
          live_state_failed: [],
          finalized_at: new Date().toISOString(),
          final_action: "reply_on_x",
          final_reason_code: "answered_from_public_knowledge",
          final_engage: true,
          final_reply_text: input.replyText ?? "Noted.",
          final_wall_body: null,
          final_identity_unverified: false,
          final_model: "p1b-harness",
          final_prompt_version: "p1b-v1",
          final_economic_intent: economicIntentToJson(economicIntent),
        })
        .select("id")
        .single();
      if (insert.error || !insert.data) {
        throw new Error("p1b_judgement_insert_failed");
      }
      judgementId = String(insert.data.id);
    }

    const decision = evaluateP1bEconomicAuthority({
      perceptionEventId: eventId,
      judgementId,
      xPostId,
      speechAction: "reply_on_x",
      replyText: input.replyText ?? "Noted.",
      economicIntent,
      trustedWallet: input.trustedWallet,
    });

    if (input.dryRun || !input.execute) {
      return {
        ok: true,
        status: "dry_run",
        operationLabel,
        xPostId,
        economicIntent,
        authorityOutcome: decision.outcome,
        policyCode: decision.policyCode,
        effectTypes: decision.effects.map((e) => e.type),
        durationMs: Date.now() - started,
      };
    }

    // Ensure policy version is on decision (already is).
    void STAGE125_POLICY_VERSION;

    await persistXPerceptionAuthorization(
      {
        perceptionEventId: eventId,
        judgementId,
        decision,
      },
      { admin: db as never },
    );

    // Execute economic effects via Stage 12.6 (may also attempt reply — may fail without X).
    // Prefer executing only economic effect types by re-running until one completes
    // when disposable rail is armed.
    const one = await executeOneXPerceptionEffect(
      { xPostId, dryRun: false },
      { admin: db as never },
    );

    return {
      ok: one.status === "completed" || decision.outcome === "permitted",
      status: one.status === "completed" ? "executed" : "authorised",
      operationLabel,
      xPostId,
      economicIntent,
      authorityOutcome: decision.outcome,
      policyCode: decision.policyCode,
      effectTypes: decision.effects.map((e) => e.type),
      externalResultId: one.externalResultId,
      economicFollowupPreview: one.economicFollowupPreview,
      errorCode: one.errorCode,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: "scaffold_failed",
      operationLabel,
      economicIntent,
      durationMs: Date.now() - started,
      errorCode:
        error instanceof Error ? error.message.slice(0, 100) : "p1b_failed",
    };
  }
}
