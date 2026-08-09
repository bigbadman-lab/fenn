/**
 * Stage P1B.1 / P1B.2 controlled economic-judgement harness (operator-only).
 *
 * P1B.1 DEFAULT: real Stage 12.4 final judge → modelEconomicAction →
 * authority preview. Dry-run never claims or broadcasts.
 *
 * P1B.2: --execute-model-intent → same real model, then Stage 12.6 +
 * disposable test rail only (never force-intent; never official FENN).
 *
 * OPTIONAL: --force-intent for authority/executor ops (NOT model judgement).
 *
 * Ordinary live X traffic never uses disposable rail via this harness.
 */

import "server-only";

import {
  STAGE125_POLICY_VERSION,
  stage12BurnPurseOperationId,
  stage12TransferPurseOperationId,
} from "@/lib/agent/authority-config";
import {
  evaluateAuthorityDecision,
  type AuthorityDecision,
} from "@/lib/agent/authority-policy";
import {
  PURSE_ORIGINAL_ALLOCATION_FORMATTED,
} from "@/lib/agent/economic-amount";
import { planEconomicEffects } from "@/lib/agent/economic-authority";
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
  sanitizeHarnessProviderFailure,
  type HarnessProviderFailure,
} from "@/lib/agent/p1b-harness-provider-error";
import {
  formatPurseEconomicStateForPrompt,
  type PurseEconomicState,
} from "@/lib/agent/purse-economic-context";
import { replyClaimsCompletedEconomicAction } from "@/lib/agent/economic-followup";
import { runFennPublicFinalJudgement } from "@/lib/agent/stage124-final-judge-model";
import type { Stage124FinalJudgeModelCaller } from "@/lib/agent/stage124-final-judge-model";
import { stage124FinalJudgementModelSchema } from "@/lib/agent/stage124-final-judgement-schema";
import { parseStage124FinalJudgementModelOutput } from "@/lib/agent/stage124-final-judgement-helpers";
import { zodResponseFormat } from "openai/helpers/zod";
import { AgentJudgeError } from "@/lib/agent/judge-errors";
import {
  buildFennPublicFinalJudgeSystemPrompt,
  buildFennPublicFinalJudgeUserPayload,
} from "@/lib/agent/stage124-final-judge-prompt";
import { FENN_UNTRUSTED_X_MARKERS } from "@/lib/agent/judge-prompt";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";
import {
  isPurseTestModeExplicitlyAllowed,
  isPurseTestModeProductionHost,
  resolveArmedPurseTestToken,
} from "@/lib/purse/test-mode";
import { FENN_PURSE_TEST_MODE_ENV } from "@/lib/purse/constants";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const AUTHOR_X_USER_ID = "9000000000000000002";

/**
 * Resolve a definite Supabase admin client for the harness.
 * Fail closed if the factory somehow returns nothing (keeps build/tsc happy).
 */
async function resolveHarnessAdminClient(
  admin?: SupabaseClient,
): Promise<SupabaseClient> {
  if (admin) return admin;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const client = createAdminClient();
  if (!client) {
    throw new Error("p1b_harness_admin_client_unavailable");
  }
  return client;
}

/**
 * Fresh synthetic snowflake per calibration run — avoids freezing an old
 * finalized judgement intent when reusing operation labels for dry-runs.
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

/** Stable id for force-intent executor tests only (label-bound). */
export function p1bForcedIntentXPostId(operationLabel: string): string {
  const label = operationLabel.trim();
  if (!label) throw new Error("operationLabel required");
  const digest = createHash("sha256").update(`p1b-force:${label}`).digest("hex");
  const n = Number.parseInt(digest.slice(0, 12), 16) % 1e15;
  return `9004${String(n).padStart(15, "0")}`;
}

/**
 * Durable synthetic post id for P1B.2 model-originated execution.
 * Same operation label → same id (retries / already_completed).
 */
export function p1b2ModelExecutionXPostId(operationLabel: string): string {
  const label = operationLabel.trim();
  if (!label) throw new Error("operationLabel required");
  const digest = createHash("sha256")
    .update(`p1b2-model-exec:${label}`)
    .digest("hex");
  const n = Number.parseInt(digest.slice(0, 12), 16) % 1e15;
  return `9006${String(n).padStart(15, "0")}`;
}

export type P1bEconomicJudgementResult = {
  ok: boolean;
  status:
    | "dry_run"
    | "forced_intent_preview"
    | "no_economic_action"
    | "economic_refused"
    | "completed"
    | "already_completed"
    | "authorised"
    | "executed"
    | "failed"
    | "ambiguous"
    | "scaffold_failed";
  mode:
    | "model_judgement"
    | "forced_intent"
    | "MODEL_JUDGEMENT_EXECUTION_TEST";
  operationLabel: string;
  runNonce?: string;
  xPostId?: string;
  untrustedText?: string;
  trustedWalletAvailable: boolean;
  trustedWallet?: string | null;
  trustedAttestation?: TrustedEconomicAttestation | null;
  modelEconomicAction?: FinalEconomicIntent;
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
  /** Deterministic authority skip reason for economic intent (null if planned). */
  authorityEconomicSkippedReason?: string | null;
  economicExecutionEligible?: boolean;
  dryRun: boolean;
  claimAttempted: boolean;
  broadcastAttempted: boolean;
  effectId?: string;
  purseOperationId?: string;
  externalResultId?: string;
  economicFollowupPreview?: string;
  isTest?: boolean;
  errorCode?: string;
  providerFailure?: HarnessProviderFailure | null;
  durationMs: number;
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
    // Calibration assumption: 10M original / remaining orientation (not live inventory).
    testBalanceFormatted: PURSE_ORIGINAL_ALLOCATION_FORMATTED,
    remainingBalanceFormatted: PURSE_ORIGINAL_ALLOCATION_FORMATTED,
    tokenDecimals: 18,
    originalAllocationFormatted: PURSE_ORIGINAL_ALLOCATION_FORMATTED,
    totalTransferredFormatted: "0",
    totalBurnedFormatted: "0",
    largestTransferFormatted: null,
    largestBurnFormatted: null,
    rolling24hOutflowFormatted: "0",
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
 * Fail-closed pre-checks for disposable-rail model execution.
 * Does not touch the signing path.
 */
export function assertP1b2DisposableRailReady(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isPurseTestModeProductionHost(env)) {
    throw new Error("p1b2_test_rail_production_host_forbidden");
  }
  if (!isPurseTestModeExplicitlyAllowed(env[FENN_PURSE_TEST_MODE_ENV])) {
    throw new Error("p1b2_test_rail_not_explicitly_allowed");
  }
  // Token config + chain arming
  resolveArmedPurseTestToken(env);
}

/** Official FENN live closes the disposable rail for P1B.2. */
export async function assertP1b2OfficialFennAbsent(
  loadOfficial: () => Promise<unknown> = async () => {
    const { getOfficialFennTokenAsset } = await import(
      "@/lib/treasury/official-token"
    );
    return getOfficialFennTokenAsset();
  },
): Promise<void> {
  const official = await loadOfficial();
  if (official) {
    throw new Error("p1b2_official_fenn_blocks_disposable_rail");
  }
}

/** Economic-only authority decision (no speech effects, no X posts). */
export function planP1bEconomicOnlyDecision(input: {
  perceptionEventId: string;
  xPostId: string;
  reasonCode?: string;
  economicIntent: FinalEconomicIntent | unknown;
  trustedWallet?: string | null;
  purseState?: PurseEconomicState | null;
}): AuthorityDecision {
  const economicIntent = normalizeModelEconomicAction(input.economicIntent);
  const planned = planEconomicEffects({
    economicIntent,
    reasonCode: input.reasonCode ?? "answered_from_public_knowledge",
    perceptionEventId: input.perceptionEventId,
    harnessBoundWallet: input.trustedWallet ?? null,
    purseState: input.purseState ?? harnessPurseState(),
    executionRail: "p1a_test",
    sufficientBalance: true,
  });

  if (planned.effects.length === 0 || economicIntent.type === "NONE") {
    return {
      outcome: "no_action",
      policyCode: "no_action",
      policyVersion: STAGE125_POLICY_VERSION,
      finalAction: "do_nothing",
      sourceXPostId: input.xPostId.trim(),
      effects: [],
      policyOutcome: "blocked",
    };
  }

  return {
    outcome: "permitted",
    policyCode: planned.policyHint ?? "permitted_transfer_p1b",
    policyVersion: STAGE125_POLICY_VERSION,
    finalAction: "do_nothing",
    sourceXPostId: input.xPostId.trim(),
    effects: planned.effects,
    policyOutcome: "blocked",
  };
}

/** Authority evaluation including speech effects (dry-run / force preview). */
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
 * Controlled harness OpenAI caller (diagnostics). Production path stays redacted.
 */
async function p1bCalibrationModelCaller(args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}): Promise<
  import("@/lib/agent/stage124-final-judgement-schema").Stage124FinalJudgementModelOutput
> {
  const { getOpenAIClient, OpenAIUnavailableError } = await import(
    "@/lib/ai/openai"
  );

  let client;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof OpenAIUnavailableError) {
      const dig = sanitizeHarnessProviderFailure(error);
      throw Object.assign(
        new AgentJudgeError(
          "judge_unavailable",
          "FENN final judgement model is not configured",
          503,
        ),
        { harnessProviderFailure: dig },
      );
    }
    throw error;
  }

  try {
    const completion = await client.chat.completions.parse({
      model: args.model,
      max_completion_tokens: args.maxCompletionTokens,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      response_format: zodResponseFormat(
        stage124FinalJudgementModelSchema,
        "fenn_public_final_judgement",
      ),
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      const dig: HarnessProviderFailure = {
        stage: "openai_no_parsed",
        status: 502,
        code: null,
        message: "Final judgement model returned no structured result",
      };
      throw Object.assign(
        new AgentJudgeError("judge_invalid_response", dig.message, 502),
        { harnessProviderFailure: dig },
      );
    }

    return parseStage124FinalJudgementModelOutput(parsed);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "harnessProviderFailure" in error
    ) {
      throw error;
    }
    if (error instanceof AgentJudgeError) throw error;
    const dig = sanitizeHarnessProviderFailure(error);
    if (dig.stage === "openai_timeout") {
      throw Object.assign(
        new AgentJudgeError("judge_timeout", dig.message, 504),
        { harnessProviderFailure: dig },
      );
    }
    throw Object.assign(
      new AgentJudgeError(
        "judge_invalid_response",
        `Final judgement model failed: ${dig.message}`,
        dig.status ?? 502,
      ),
      { harnessProviderFailure: dig },
    );
  }
}

function baseResult(partial: Partial<P1bEconomicJudgementResult> & {
  ok: boolean;
  status: P1bEconomicJudgementResult["status"];
  mode: P1bEconomicJudgementResult["mode"];
  operationLabel: string;
  intentForced: boolean;
  dryRun: boolean;
  claimAttempted: boolean;
  broadcastAttempted: boolean;
  trustedWalletAvailable: boolean;
  durationMs: number;
}): P1bEconomicJudgementResult {
  return partial;
}

function mapExecuteStatus(
  status: string,
): P1bEconomicJudgementResult["status"] {
  if (status === "completed") return "completed";
  if (status === "already_completed_skipped") return "already_completed";
  if (status === "dry_run") return "dry_run";
  if (status === "failed") return "failed";
  return "failed";
}

function purseOpIdForEffect(
  effectType: string | undefined,
  effectId: string | undefined,
): string | undefined {
  if (!effectId) return undefined;
  if (effectType === "burn_fenn") return stage12BurnPurseOperationId(effectId);
  if (effectType === "transfer_fenn") {
    return stage12TransferPurseOperationId(effectId);
  }
  return undefined;
}

/**
 * Run real Stage 12.4 final judge calibration / P1B.2 model-originated execution.
 */
export async function runP1bEconomicJudgementTest(input: {
  operationLabel: string;
  text: string;
  trustedWallet?: string | null;
  attestation?: TrustedEconomicAttestation | null;
  forceIntent?: FinalEconomicIntent | null;
  replyText?: string;
  dryRun?: boolean;
  /** Legacy force-intent execute path only. */
  execute?: boolean;
  /**
   * P1B.2: real model judgement then Stage 12.6 disposable settlement.
   * Never uses force-intent. Default false.
   */
  executeModelIntent?: boolean;
  admin?: SupabaseClient;
  callModel?: Stage124FinalJudgeModelCaller;
  /** Inject Stage 12.6 deps (tests). */
  executeEffect?: typeof import("@/lib/agent/stage126-execute").executeOneXPerceptionEffect;
  env?: NodeJS.ProcessEnv;
  /** Test hook: load official FENN (null allowed). */
  loadOfficialFenn?: () => Promise<unknown>;
}): Promise<P1bEconomicJudgementResult> {
  const started = Date.now();
  const operationLabel = input.operationLabel.trim();
  const text = input.text.slice(0, 2000);
  const executeModelIntent = input.executeModelIntent === true;
  const forceMode = Boolean(input.forceIntent);
  const forceExecute =
    Boolean(input.execute) && forceMode && !executeModelIntent;
  const dryRun = executeModelIntent || forceExecute ? false : input.dryRun !== false;

  const trustedWallet = input.trustedWallet?.trim() || null;
  const trustedWalletAvailable = Boolean(trustedWallet);
  const attestation = input.attestation ?? null;
  const purseState = harnessPurseState();
  const purseBlock = formatPurseEconomicStateForPrompt(purseState);
  const attestationBlock =
    formatTrustedEconomicAttestationForPrompt(attestation);

  const copyForwardNote =
    "Production Stage 12.4 copy-forward (no live caps) hard-sets economic NONE without re-judge; this harness always uses the real final-judge path.";

  const env = input.env ?? process.env;

  try {
    if (executeModelIntent && forceMode) {
      return baseResult({
        ok: false,
        status: "failed",
        mode: "MODEL_JUDGEMENT_EXECUTION_TEST",
        operationLabel,
        trustedWalletAvailable,
        trustedWallet,
        trustedAttestation: attestation,
        intentForced: true,
        dryRun: true,
        claimAttempted: false,
        broadcastAttempted: false,
        errorCode: "p1b2_force_intent_incompatible_with_model_execution",
        durationMs: Date.now() - started,
        copyForwardNote,
      });
    }

    if (forceMode) {
      return await runForceIntentBranch({
        input,
        operationLabel,
        text,
        dryRun: !forceExecute,
        forceExecute,
        trustedWallet,
        trustedWalletAvailable,
        attestation,
        purseState,
        started,
        copyForwardNote,
      });
    }

    // --- Real model path ---
    if (executeModelIntent) {
      try {
        assertP1b2DisposableRailReady(env);
        await assertP1b2OfficialFennAbsent(input.loadOfficialFenn);
      } catch (error) {
        return baseResult({
          ok: false,
          status: "failed",
          mode: "MODEL_JUDGEMENT_EXECUTION_TEST",
          operationLabel,
          untrustedText: text,
          trustedWalletAvailable,
          trustedWallet,
          trustedAttestation: attestation,
          intentForced: false,
          dryRun: true,
          claimAttempted: false,
          broadcastAttempted: false,
          errorCode:
            error instanceof Error
              ? error.message.slice(0, 120)
              : "p1b2_test_rail_refused",
          isTest: true,
          durationMs: Date.now() - started,
          copyForwardNote,
        });
      }
    }

    // Durable identity for execution retries; random for dry calibration samples.
    const runNonce = executeModelIntent
      ? `exec-${operationLabel}`
      : randomBytes(8).toString("hex");
    const xPostId = executeModelIntent
      ? p1b2ModelExecutionXPostId(operationLabel)
      : p1bCalibrationXPostId(operationLabel, runNonce);
    const provisionalPerceptionId = executeModelIntent
      ? `pe-p1b2-${operationLabel}`
      : `pe-cal-${runNonce}`;

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
      callModel: input.callModel ?? p1bCalibrationModelCaller,
    });

    const modelEconomicAction = intention.economicIntent;
    const speechAction = intention.action;
    const replyText = intention.replyText;

    // Authority preview uses provisional id; execution rebinds to DB event id.
    const decisionPreview = evaluateP1bEconomicAuthority({
      perceptionEventId: provisionalPerceptionId,
      xPostId,
      speechAction: speechAction as "reply_on_x" | "do_nothing" | "reply_and_write_to_wall",
      replyText,
      reasonCode: intention.reasonCode,
      economicIntent: modelEconomicAction,
      trustedWallet,
      purseState,
    });

    const economicPlanned = decisionPreview.effects.filter(
      (e) => e.type === "transfer_fenn" || e.type === "burn_fenn",
    );

    const plannedEffectsPayload = decisionPreview.effects.map((e) => ({
      type: e.type,
      idempotencyKey: e.idempotencyKey,
      payload: e.payload,
    }));

    const economicAuthorityPlan = planEconomicEffects({
      economicIntent: modelEconomicAction,
      reasonCode: intention.reasonCode,
      perceptionEventId: provisionalPerceptionId,
      harnessBoundWallet: trustedWallet,
      purseState,
      executionRail: "p1a_test",
      sufficientBalance: true,
    });

    // ---- Dry-run calibration (default) ----
    if (!executeModelIntent) {
      if (input.execute === true && !forceMode) {
        return baseResult({
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
          speechAction,
          replyText,
          authorityOutcome: decisionPreview.outcome,
          policyCode: decisionPreview.policyCode,
          authorityPlannedEffects: plannedEffectsPayload,
          authorityEconomicSkippedReason: economicAuthorityPlan.skippedReason,
          dryRun: true,
          claimAttempted: false,
          broadcastAttempted: false,
          errorCode: "p1b_calibration_execute_forbidden",
          durationMs: Date.now() - started,
          copyForwardNote,
        });
      }

      return baseResult({
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
        speechAction,
        replyText,
        authorityOutcome: decisionPreview.outcome,
        policyCode: decisionPreview.policyCode,
        authorityPlannedEffects: plannedEffectsPayload,
        authorityEconomicSkippedReason: economicAuthorityPlan.skippedReason,
        economicExecutionEligible: economicPlanned.length > 0,
        dryRun: true,
        claimAttempted: false,
        broadcastAttempted: false,
        isTest: true,
        durationMs: Date.now() - started,
        copyForwardNote,
      });
    }

    // ---- P1B.2 model-originated execution ----
    if (modelEconomicAction.type === "NONE") {
      return baseResult({
        ok: true,
        status: "no_economic_action",
        mode: "MODEL_JUDGEMENT_EXECUTION_TEST",
        operationLabel,
        runNonce,
        xPostId,
        untrustedText: text,
        trustedWalletAvailable,
        trustedWallet,
        trustedAttestation: attestation,
        modelEconomicAction,
        intentForced: false,
        speechAction,
        replyText,
        authorityOutcome: decisionPreview.outcome,
        policyCode: decisionPreview.policyCode,
        authorityPlannedEffects: plannedEffectsPayload,
        economicExecutionEligible: false,
        dryRun: false,
        claimAttempted: false,
        broadcastAttempted: false,
        isTest: true,
        durationMs: Date.now() - started,
        copyForwardNote,
      });
    }

    // Economic-only decision for persist (no X reply effect).
    const economicDecisionForPreview = planP1bEconomicOnlyDecision({
      perceptionEventId: provisionalPerceptionId,
      xPostId,
      reasonCode: intention.reasonCode,
      economicIntent: modelEconomicAction,
      trustedWallet,
      purseState,
    });

    const economicOnly = economicDecisionForPreview.effects.filter(
      (e) => e.type === "transfer_fenn" || e.type === "burn_fenn",
    );

    if (economicOnly.length === 0) {
      return baseResult({
        ok: true,
        status: "economic_refused",
        mode: "MODEL_JUDGEMENT_EXECUTION_TEST",
        operationLabel,
        runNonce,
        xPostId,
        untrustedText: text,
        trustedWalletAvailable,
        trustedWallet,
        trustedAttestation: attestation,
        modelEconomicAction,
        intentForced: false,
        speechAction,
        replyText,
        authorityOutcome: economicDecisionForPreview.outcome,
        policyCode: economicDecisionForPreview.policyCode,
        authorityPlannedEffects: economicDecisionForPreview.effects.map((e) => ({
          type: e.type,
          idempotencyKey: e.idempotencyKey,
          payload: e.payload,
        })),
        economicExecutionEligible: false,
        dryRun: false,
        claimAttempted: false,
        broadcastAttempted: false,
        isTest: true,
        durationMs: Date.now() - started,
        copyForwardNote,
      });
    }

    const db = await resolveHarnessAdminClient(input.admin);

    // Scaffold event + judgement first so we have durable perceptionEventId.
    const { data: existingEvent } = await db
      .from("x_perception_events")
      .select("id")
      .eq("x_post_id", xPostId)
      .maybeSingle();

    let perceptionEventId: string;
    if (existingEvent?.id) {
      perceptionEventId = String(existingEvent.id);
    } else {
      const insert = await db
        .from("x_perception_events")
        .insert({
          x_post_id: xPostId,
          perception_type: "mention",
          author_x_user_id: AUTHOR_X_USER_ID,
          author_username: "p1b2_model_exec",
          author_display_name: "P1B.2 Model Execution",
          body: text,
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
        if (retry.error || !retry.data) {
          throw new Error("p1b2_event_insert_failed");
        }
        perceptionEventId = String(retry.data.id);
      } else {
        perceptionEventId = String(insert.data.id);
      }
    }

    // Durable economic plan keyed to real event UUID.
    const decisionDurable = planP1bEconomicOnlyDecision({
      perceptionEventId,
      xPostId,
      reasonCode: intention.reasonCode,
      economicIntent: modelEconomicAction,
      trustedWallet,
      purseState,
    });

    const durableEconomic = decisionDurable.effects.filter(
      (e) => e.type === "transfer_fenn" || e.type === "burn_fenn",
    );
    if (durableEconomic.length === 0) {
      return baseResult({
        ok: true,
        status: "economic_refused",
        mode: "MODEL_JUDGEMENT_EXECUTION_TEST",
        operationLabel,
        runNonce,
        xPostId,
        untrustedText: text,
        trustedWalletAvailable,
        trustedWallet,
        trustedAttestation: attestation,
        modelEconomicAction,
        intentForced: false,
        speechAction,
        replyText,
        authorityOutcome: decisionDurable.outcome,
        policyCode: decisionDurable.policyCode,
        authorityPlannedEffects: decisionDurable.effects.map((e) => ({
          type: e.type,
          idempotencyKey: e.idempotencyKey,
          payload: e.payload,
        })),
        dryRun: false,
        claimAttempted: false,
        broadcastAttempted: false,
        isTest: true,
        durationMs: Date.now() - started,
        copyForwardNote,
      });
    }

    const persistDecision: AuthorityDecision = {
      ...decisionDurable,
      effects: durableEconomic,
      finalAction: "do_nothing",
      sourceXPostId: xPostId,
      policyVersion: STAGE125_POLICY_VERSION,
    };

    const replyForAudit =
      replyText && replyClaimsCompletedEconomicAction(replyText)
        ? "I have considered this. Settlement is not claimed until confirmed."
        : replyText;

    const { data: existingJudgement } = await db
      .from("x_perception_judgements")
      .select("id")
      .eq("perception_event_id", perceptionEventId)
      .maybeSingle();

    let judgementId: string;
    if (existingJudgement?.id) {
      judgementId = String(existingJudgement.id);
    } else {
      const insertJ = await db
        .from("x_perception_judgements")
        .insert({
          perception_event_id: perceptionEventId,
          action: speechAction,
          reason_code: intention.reasonCode,
          engage: true,
          reply_text: replyForAudit,
          wall_body: null,
          needs_live_state: [],
          identity_unverified: false,
          knowledge_available: true,
          model: "p1b2-model-originated",
          prompt_version: "p1b2-v1",
          final_status: "finalized",
          live_state_available: true,
          live_state_succeeded: [],
          live_state_failed: [],
          finalized_at: new Date().toISOString(),
          final_action: "do_nothing",
          final_reason_code: intention.reasonCode,
          final_engage: false,
          final_reply_text: replyForAudit,
          final_wall_body: null,
          final_identity_unverified: false,
          final_model: "p1b2-model-originated",
          final_prompt_version: "p1b2-v1",
          final_economic_intent: economicIntentToJson(modelEconomicAction),
        })
        .select("id")
        .single();
      if (insertJ.error || !insertJ.data) {
        const retry = await db
          .from("x_perception_judgements")
          .select("id")
          .eq("perception_event_id", perceptionEventId)
          .maybeSingle();
        if (retry.error || !retry.data) {
          throw new Error("p1b2_judgement_insert_failed");
        }
        judgementId = String(retry.data.id);
      } else {
        judgementId = String(insertJ.data.id);
      }
    }

    const { persistXPerceptionAuthorization } = await import(
      "@/lib/agent/authority-persist"
    );
    await persistXPerceptionAuthorization(
      {
        perceptionEventId,
        judgementId,
        decision: persistDecision,
      },
      { admin: db as never },
    );

    const { data: effects } = await db
      .from("x_perception_effects")
      .select("id, type, status")
      .eq("perception_event_id", perceptionEventId);

    const econEffect = (effects ?? []).find((e) => {
      const t = String((e as { type?: string }).type ?? "");
      return t === "transfer_fenn" || t === "burn_fenn";
    }) as { id?: string; type?: string; status?: string } | undefined;

    // Prefer completed economic effect on re-run without rebroadcasting via empty claim
    if (econEffect?.status === "completed") {
      const effectId = String(econEffect.id);
      return baseResult({
        ok: true,
        status: "already_completed",
        mode: "MODEL_JUDGEMENT_EXECUTION_TEST",
        operationLabel,
        runNonce,
        xPostId,
        untrustedText: text,
        trustedWalletAvailable,
        trustedWallet,
        trustedAttestation: attestation,
        modelEconomicAction,
        intentForced: false,
        speechAction,
        replyText: replyForAudit,
        authorityOutcome: persistDecision.outcome,
        policyCode: persistDecision.policyCode,
        authorityPlannedEffects: persistDecision.effects.map((e) => ({
          type: e.type,
          idempotencyKey: e.idempotencyKey,
          payload: e.payload,
        })),
        economicExecutionEligible: true,
        dryRun: false,
        claimAttempted: false,
        broadcastAttempted: false,
        effectId,
        purseOperationId: purseOpIdForEffect(econEffect.type, effectId),
        isTest: true,
        durationMs: Date.now() - started,
        copyForwardNote,
      });
    }

    const executeOne =
      input.executeEffect ??
      (await import("@/lib/agent/stage126-execute")).executeOneXPerceptionEffect;

    const one = await executeOne(
      { xPostId, dryRun: false },
      { admin: db as never },
    );

    const effectId = one.effectId ?? (econEffect?.id ? String(econEffect.id) : undefined);
    const effectType = one.effectType ?? econEffect?.type;
    let status = mapExecuteStatus(one.status);
    if (one.failureClass === "ambiguous" || one.errorCode === "purse_ambiguous") {
      status = "ambiguous";
    }
    if (one.status === "already_completed_skipped") {
      status = "already_completed";
    }

    const signed =
      one.status === "completed" || one.status === "already_completed_skipped";

    return baseResult({
      ok:
        status === "completed" ||
        status === "already_completed" ||
        status === "ambiguous",
      status,
      mode: "MODEL_JUDGEMENT_EXECUTION_TEST",
      operationLabel,
      runNonce,
      xPostId,
      untrustedText: text,
      trustedWalletAvailable,
      trustedWallet,
      trustedAttestation: attestation,
      modelEconomicAction,
      intentForced: false,
      speechAction,
      replyText: replyForAudit,
      authorityOutcome: persistDecision.outcome,
      policyCode: persistDecision.policyCode,
      authorityPlannedEffects: persistDecision.effects.map((e) => ({
        type: e.type,
        idempotencyKey: e.idempotencyKey,
        payload: e.payload,
      })),
      economicExecutionEligible: true,
      dryRun: false,
      claimAttempted: true,
      broadcastAttempted: signed || one.status === "failed",
      effectId,
      purseOperationId: purseOpIdForEffect(effectType, effectId),
      externalResultId: one.externalResultId,
      economicFollowupPreview: one.economicFollowupPreview,
      isTest: true,
      errorCode: one.errorCode,
      durationMs: Date.now() - started,
      copyForwardNote,
    });
  } catch (error) {
    const providerFailure =
      error &&
      typeof error === "object" &&
      "harnessProviderFailure" in error &&
      (error as { harnessProviderFailure?: HarnessProviderFailure })
        .harnessProviderFailure
        ? (error as { harnessProviderFailure: HarnessProviderFailure })
            .harnessProviderFailure
        : error instanceof Error
          ? sanitizeHarnessProviderFailure(error)
          : null;

    return baseResult({
      ok: false,
      status: "scaffold_failed",
      mode: forceMode
        ? "forced_intent"
        : executeModelIntent
          ? "MODEL_JUDGEMENT_EXECUTION_TEST"
          : "model_judgement",
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
        error instanceof Error ? error.message.slice(0, 180) : "p1b_failed",
      providerFailure,
      copyForwardNote,
    });
  }
}

async function runForceIntentBranch(args: {
  input: {
    forceIntent?: FinalEconomicIntent | null;
    replyText?: string;
    admin?: SupabaseClient;
    execute?: boolean;
  };
  operationLabel: string;
  text: string;
  dryRun: boolean;
  forceExecute: boolean;
  trustedWallet: string | null;
  trustedWalletAvailable: boolean;
  attestation: TrustedEconomicAttestation | null;
  purseState: PurseEconomicState;
  started: number;
  copyForwardNote: string;
}): Promise<P1bEconomicJudgementResult> {
  const {
    operationLabel,
    text,
    dryRun,
    forceExecute,
    trustedWallet,
    trustedWalletAvailable,
    attestation,
    purseState,
    started,
    copyForwardNote,
  } = args;
  const forced = normalizeModelEconomicAction(args.input.forceIntent);
  const runNonce = `force-${Date.now()}`;
  const xPostId = p1bForcedIntentXPostId(
    `${operationLabel}:${runNonce.slice(-8)}`,
  );
  const perceptionEventId = `pe-force-${runNonce}`;
  const decision = evaluateP1bEconomicAuthority({
    perceptionEventId,
    xPostId,
    speechAction: "reply_on_x",
    replyText: args.input.replyText ?? "Noted.",
    economicIntent: forced,
    trustedWallet,
    purseState,
  });

  if (forceExecute) {
    const { persistXPerceptionAuthorization } = await import(
      "@/lib/agent/authority-persist"
    );
    const { executeOneXPerceptionEffect } = await import(
      "@/lib/agent/stage126-execute"
    );
    const db = await resolveHarnessAdminClient(args.input.admin);

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
        reply_text: args.input.replyText ?? "Noted.",
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
        final_action: "do_nothing",
        final_reason_code: "answered_from_public_knowledge",
        final_engage: false,
        final_reply_text: null,
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
    const decisionLive = planP1bEconomicOnlyDecision({
      perceptionEventId: eventId,
      xPostId,
      economicIntent: forced,
      trustedWallet,
      purseState,
    });
    const economicOnly = decisionLive.effects.filter(
      (e) => e.type === "transfer_fenn" || e.type === "burn_fenn",
    );
    await persistXPerceptionAuthorization(
      {
        perceptionEventId: eventId,
        judgementId: String(insertJ.data.id),
        decision: decisionLive,
      },
      { admin: db as never },
    );
    const one = await executeOneXPerceptionEffect(
      {
        xPostId,
        dryRun: false,
        effectTypes: ["transfer_fenn", "burn_fenn"],
      },
      { admin: db as never },
    );
    return baseResult({
      ok: one.status === "completed" || one.status === "already_completed_skipped",
      status: mapExecuteStatus(one.status),
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
      replyText: args.input.replyText ?? "Noted.",
      authorityOutcome: decisionLive.outcome,
      policyCode: decisionLive.policyCode,
      authorityPlannedEffects: economicOnly.map((e) => ({
        type: e.type,
        idempotencyKey: e.idempotencyKey,
        payload: e.payload,
      })),
      economicExecutionEligible: true,
      dryRun: false,
      claimAttempted: true,
      broadcastAttempted: true,
      effectId: one.effectId,
      purseOperationId: purseOpIdForEffect(one.effectType, one.effectId),
      externalResultId: one.externalResultId,
      economicFollowupPreview: one.economicFollowupPreview,
      isTest: true,
      errorCode: one.errorCode,
      durationMs: Date.now() - started,
      copyForwardNote,
    });
  }

  return baseResult({
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
    replyText: args.input.replyText ?? "Noted.",
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
  });
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
  void FENN_UNTRUSTED_X_MARKERS;
  return { system, user };
}

