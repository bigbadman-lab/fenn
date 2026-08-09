/**
 * Stage P1B.1 controlled economic-judgement harness (operator-only).
 *
 * DEFAULT: real Stage 12.4 final judge model → modelEconomicAction →
 * authority preview. Dry-run never claims or broadcasts.
 *
 * OPTIONAL: --force-intent injects operator intent for authority/executor only
 * (explicitly labelled; not calibration).
 *
 * Copy-forward production paths that hard-set NONE are not used here.
 * Ordinary live X traffic never uses disposable rail via this harness.
 */

import "server-only";

import {
  STAGE125_POLICY_VERSION,
} from "@/lib/agent/authority-config";
import {
  evaluateAuthorityDecision,
  type AuthorityDecision,
} from "@/lib/agent/authority-policy";
import {
  economicIntentToJson,
  normalizeModelEconomicAction,
  type FinalEconomicIntent,
} from "@/lib/agent/economic-intent";
import {
  formatTrustedEconomicAttestationForPrompt,
  type TrustedEconomicAttestation,
} from "@/lib/agent/economic-attestation";
import {
  formatPurseEconomicStateForPrompt,
  type PurseEconomicState,
} from "@/lib/agent/purse-economic-context";
import { runFennPublicFinalJudgement } from "@/lib/agent/stage124-final-judge-model";
import type { Stage124FinalJudgeModelCaller } from "@/lib/agent/stage124-final-judge-model";
import {
  buildFennPublicFinalJudgeSystemPrompt,
  buildFennPublicFinalJudgeUserPayload,
} from "@/lib/agent/stage124-final-judge-prompt";
import { FENN_UNTRUSTED_X_MARKERS } from "@/lib/agent/judge-prompt";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const AUTHOR_X_USER_ID = "9000000000000000002";

/**
 * Fresh synthetic snowflake per calibration run — avoids freezing an old
 * finalized judgement intent when reusing operation labels.
 * Production finality is never weakened (no production row mutation).
 */
export function p1bCalibrationXPostId(
  operationLabel: string,
  runNonce: string,
): string {
  const label = operationLabel.trim();
  const nonce = runNonce.trim();
  if (!label || !nonce) throw new Error("operationLabel and runNonce required");
  const digest = createHash("sha256")
    .update(`p1b1:${label}:${nonce}`)
    .digest("hex");
  const n = Number.parseInt(digest.slice(0, 12), 16) % 1e15;
  return `9005${String(n).padStart(15, "0")}`;
}

/** Stable id for forced-intent executor tests only (label-bound). */
export function p1bForcedIntentXPostId(operationLabel: string): string {
  const label = operationLabel.trim();
  if (!label) throw new Error("operationLabel required");
  const digest = createHash("sha256").update(`p1b-force:${label}`).digest("hex");
  const n = Number.parseInt(digest.slice(0, 12), 16) % 1e15;
  return `9004${String(n).padStart(15, "0")}`;
}

export type P1bEconomicJudgementResult = {
  ok: boolean;
  status:
    | "dry_run"
    | "forced_intent_preview"
    | "authorised"
    | "executed"
    | "failed"
    | "scaffold_failed";
  mode: "model_judgement" | "forced_intent";
  operationLabel: string;
  runNonce?: string;
  xPostId?: string;
  untrustedText?: string;
  trustedWalletAvailable: boolean;
  trustedWallet?: string | null;
  trustedAttestation?: TrustedEconomicAttestation | null;
  /** Real model (or force) economic intention. */
  modelEconomicAction?: FinalEconomicIntent;
  /** True when modelEconomicAction was operator-injected via force mode. */
  intentForced: boolean;
  speechAction?: string;
  replyText?: string | null;
  authorityOutcome?: string;
  policyCode?: string;
  authorityPlannedEffects?: Array<{
    type: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }>;
  economicExecutionEligible?: boolean;
  dryRun: boolean;
  claimAttempted: boolean;
  broadcastAttempted: boolean;
  externalResultId?: string;
  economicFollowupPreview?: string;
  errorCode?: string;
  durationMs: number;
  /** Production note for docs/tests. */
  copyForwardNote?: string;
};

export function harnessPurseState(
  overrides?: Partial<PurseEconomicState>,
): PurseEconomicState {
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
 * Authority-only evaluation for harness / unit tests (no DB for decision).
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
 * Run real Stage 12.4 final judge calibration (default path).
 * Dry-run by default: no claim, no settlement, no broadcast.
 */
export async function runP1bEconomicJudgementTest(input: {
  operationLabel: string;
  text: string;
  trustedWallet?: string | null;
  attestation?: TrustedEconomicAttestation | null;
  /**
   * Operator bypass for authority/executor tests only.
   * When set, model is NOT called; labelled intentForced.
   */
  forceIntent?: FinalEconomicIntent | null;
  replyText?: string;
  dryRun?: boolean;
  /** Only with forceIntent — optional execute through Stage 12.6. */
  execute?: boolean;
  admin?: SupabaseClient;
  /** Inject model for tests; production calibration uses real OpenAI. */
  callModel?: Stage124FinalJudgeModelCaller;
}): Promise<P1bEconomicJudgementResult> {
  const started = Date.now();
  const operationLabel = input.operationLabel.trim();
  const text = input.text.slice(0, 2000);
  const dryRun = input.execute === true ? false : input.dryRun !== false;
  const forceMode = Boolean(input.forceIntent);
  const trustedWallet = input.trustedWallet?.trim() || null;
  const trustedWalletAvailable = Boolean(trustedWallet);
  const attestation = input.attestation ?? null;
  const purseState = harnessPurseState();
  const purseBlock = formatPurseEconomicStateForPrompt(purseState);
  const attestationBlock =
    formatTrustedEconomicAttestationForPrompt(attestation);

  const copyForwardNote =
    "Production Stage 12.4 copy-forward (no live caps) hard-sets economic NONE without re-judge; this harness always uses the real final-judge path.";

  try {
    if (forceMode) {
      // Forced-intent authority preview (or execute) — never called model judgement.
      const forced = normalizeModelEconomicAction(input.forceIntent);
      const runNonce = `force-${Date.now()}`;
      const xPostId = p1bForcedIntentXPostId(
        `${operationLabel}:${runNonce.slice(-8)}`,
      );
      const perceptionEventId = `pe-force-${runNonce}`;
      const decision = evaluateP1bEconomicAuthority({
        perceptionEventId,
        xPostId,
        speechAction: "reply_on_x",
        replyText: input.replyText ?? "Noted.",
        economicIntent: forced,
        trustedWallet,
        purseState,
      });

      if (!dryRun && input.execute) {
        // Optional execution for force mode only (P1A-style path retained).
        const { persistXPerceptionAuthorization } = await import(
          "@/lib/agent/authority-persist"
        );
        const { executeOneXPerceptionEffect } = await import(
          "@/lib/agent/stage126-execute"
        );
        const db = input.admin ?? (await import("@/lib/supabase/admin").then((m) =>
          m.createAdminClient(),
        ));

        // Fresh event+judgement for force execute; no reuse of old finals.
        const insertEvent = await db
          .from("x_perception_events")
          .insert({
            x_post_id: xPostId,
            perception_type: "mention",
            author_x_user_id: AUTHOR_X_USER_ID,
            author_username: "p1b_force_test",
            author_display_name: "P1B Force Intent",
            body: text,
            conversation_id: null,
            referenced_tweet_ids: [],
            x_created_at: new Date().toISOString(),
            status: "processed",
            processed_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (insertEvent.error || !insertEvent.data) {
          throw new Error("p1b_force_event_insert_failed");
        }
        const eventId = String(insertEvent.data.id);
        const insertJ = await db
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
            model: "p1b-force-intent",
            prompt_version: "p1b1-force",
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
            final_model: "p1b-force-intent",
            final_prompt_version: "p1b1-force",
            final_economic_intent: economicIntentToJson(forced),
          })
          .select("id")
          .single();
        if (insertJ.error || !insertJ.data) {
          throw new Error("p1b_force_judgement_insert_failed");
        }
        const decisionLive = evaluateP1bEconomicAuthority({
          perceptionEventId: eventId,
          judgementId: String(insertJ.data.id),
          xPostId,
          speechAction: "reply_on_x",
          replyText: input.replyText ?? "Noted.",
          economicIntent: forced,
          trustedWallet,
          purseState,
        });
        await persistXPerceptionAuthorization(
          {
            perceptionEventId: eventId,
            judgementId: String(insertJ.data.id),
            decision: decisionLive,
          },
          { admin: db as never },
        );
        const one = await executeOneXPerceptionEffect(
          { xPostId, dryRun: false },
          { admin: db as never },
        );
        void STAGE125_POLICY_VERSION;
        return {
          ok: one.status === "completed" || decisionLive.outcome === "permitted",
          status: one.status === "completed" ? "executed" : "authorised",
          mode: "forced_intent",
          operationLabel,
          runNonce,
          xPostId,
          untrustedText: text,
          trustedWalletAvailable,
          trustedWallet,
          trustedAttestation: attestation,
          modelEconomicAction: forced,
          intentForced: true,
          speechAction: "reply_on_x",
          replyText: input.replyText ?? "Noted.",
          authorityOutcome: decisionLive.outcome,
          policyCode: decisionLive.policyCode,
          authorityPlannedEffects: decisionLive.effects.map((e) => ({
            type: e.type,
            idempotencyKey: e.idempotencyKey,
            payload: e.payload,
          })),
          economicExecutionEligible: true,
          dryRun: false,
          claimAttempted: true,
          broadcastAttempted: true,
          externalResultId: one.externalResultId,
          economicFollowupPreview: one.economicFollowupPreview,
          errorCode: one.errorCode,
          durationMs: Date.now() - started,
          copyForwardNote,
        };
      }

      return {
        ok: true,
        status: "forced_intent_preview",
        mode: "forced_intent",
        operationLabel,
        runNonce,
        xPostId,
        untrustedText: text,
        trustedWalletAvailable,
        trustedWallet,
        trustedAttestation: attestation,
        modelEconomicAction: forced,
        intentForced: true,
        speechAction: "reply_on_x",
        replyText: input.replyText ?? "Noted.",
        authorityOutcome: decision.outcome,
        policyCode: decision.policyCode,
        authorityPlannedEffects: decision.effects.map((e) => ({
          type: e.type,
          idempotencyKey: e.idempotencyKey,
          payload: e.payload,
        })),
        economicExecutionEligible: decision.effects.some(
          (e) => e.type === "transfer_fenn" || e.type === "burn_fenn",
        ),
        dryRun: true,
        claimAttempted: false,
        broadcastAttempted: false,
        durationMs: Date.now() - started,
        copyForwardNote,
      };
    }

    // --- Real model calibration path (default) ---
    const runNonce = randomBytes(8).toString("hex");
    const xPostId = p1bCalibrationXPostId(operationLabel, runNonce);
    const perceptionEventId = `pe-cal-${runNonce}`;

    const intention = await runFennPublicFinalJudgement({
      xPostId,
      perceptionType: "mention",
      authorXUserId: AUTHOR_X_USER_ID,
      authorUsername: "p1b_econ_calibration",
      body: text,
      knowledgeAvailable: true,
      knowledgeContext: null,
      trustedLiveStateBlock:
        "No additional live public-fact reads for this harness run. Prefer TRUSTED ECONOMIC ATTESTATION and THE PURSE when judging economy.",
      liveStateAnyAvailable: true,
      trustedPurseStateBlock: purseBlock,
      trustedWalletAvailable,
      trustedEconomicAttestationBlock: attestationBlock,
      callModel: input.callModel,
    });

    const modelEconomicAction = intention.economicIntent;
    const decision = evaluateP1bEconomicAuthority({
      perceptionEventId,
      xPostId,
      speechAction: intention.action,
      replyText: intention.replyText,
      reasonCode: intention.reasonCode,
      economicIntent: modelEconomicAction,
      trustedWallet,
      purseState,
    });

    // Calibration always ends as dry-run for model path — no claim/broadcast.
    if (!dryRun) {
      // Hard safety: model calibration must not become execution path.
      return {
        ok: false,
        status: "failed",
        mode: "model_judgement",
        operationLabel,
        runNonce,
        xPostId,
        untrustedText: text,
        trustedWalletAvailable,
        trustedWallet,
        trustedAttestation: attestation,
        modelEconomicAction,
        intentForced: false,
        dryRun: true,
        claimAttempted: false,
        broadcastAttempted: false,
        errorCode: "p1b_calibration_execute_forbidden",
        durationMs: Date.now() - started,
        copyForwardNote,
      };
    }

    return {
      ok: true,
      status: "dry_run",
      mode: "model_judgement",
      operationLabel,
      runNonce,
      xPostId,
      untrustedText: text,
      trustedWalletAvailable,
      trustedWallet,
      trustedAttestation: attestation,
      modelEconomicAction,
      intentForced: false,
      speechAction: intention.action,
      replyText: intention.replyText,
      authorityOutcome: decision.outcome,
      policyCode: decision.policyCode,
      authorityPlannedEffects: decision.effects.map((e) => ({
        type: e.type,
        idempotencyKey: e.idempotencyKey,
        payload: e.payload,
      })),
      economicExecutionEligible: decision.effects.some(
        (e) => e.type === "transfer_fenn" || e.type === "burn_fenn",
      ),
      dryRun: true,
      claimAttempted: false,
      broadcastAttempted: false,
      durationMs: Date.now() - started,
      copyForwardNote,
    };
  } catch (error) {
    return {
      ok: false,
      status: "scaffold_failed",
      mode: forceMode ? "forced_intent" : "model_judgement",
      operationLabel,
      untrustedText: text,
      trustedWalletAvailable,
      trustedWallet,
      trustedAttestation: attestation,
      intentForced: forceMode,
      dryRun: true,
      claimAttempted: false,
      broadcastAttempted: false,
      durationMs: Date.now() - started,
      errorCode:
        error instanceof Error ? error.message.slice(0, 120) : "p1b_failed",
      copyForwardNote,
    };
  }
}

/**
 * Helps structural tests: assemble judge payload strings without OpenAI.
 */
export function buildP1bCalibrationPromptBodies(input: {
  text: string;
  trustedWalletAvailable: boolean;
  attestation?: TrustedEconomicAttestation | null;
  purseState?: PurseEconomicState;
}): { system: string; user: string } {
  const system = buildFennPublicFinalJudgeSystemPrompt();
  const user = buildFennPublicFinalJudgeUserPayload({
    xPostId: "9005000000000000001",
    perceptionType: "mention",
    authorXUserId: AUTHOR_X_USER_ID,
    authorUsername: "p1b_econ_calibration",
    body: input.text,
    knowledgeAvailable: true,
    knowledgeContext: null,
    trustedLiveStateBlock: "Harness live-state placeholder.",
    trustedPurseStateBlock: formatPurseEconomicStateForPrompt(
      input.purseState ?? harnessPurseState(),
    ),
    trustedWalletAvailable: input.trustedWalletAvailable,
    trustedEconomicAttestationBlock: formatTrustedEconomicAttestationForPrompt(
      input.attestation ?? null,
    ),
  });
  // Untrusted markers used by production payload builder
  void FENN_UNTRUSTED_X_MARKERS;
  return { system, user };
}
