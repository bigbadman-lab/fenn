/**
 * Full disposable MVP economic rehearsal harness (operator-only).
 *
 * Composes existing stages only — no redesign:
 *   P1B Stage 12.4 model judgement (real, no force-intent)
 *   P1C variable amount + authority envelope (no clamp)
 *   P1D wallet collection FSM + P1D.1 Book of Speech wallet replies
 *   Stage 12.5 economic effects (pending_destination → confirmed wallet transfer)
 *   Stage 12.6 + Purse disposable test rail
 *   P1E completion speech (preview only — never live X by default)
 *
 * Modes:
 *   default / dry-run  → real model + FSM + speech previews; no chain; no live X
 *   --execute-test     → durable Supabase rows + Stage 12.6 + disposable chain only
 */

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  STAGE125_POLICY_VERSION,
  stage12BurnPurseOperationId,
  stage12TransferPurseOperationId,
} from "@/lib/agent/authority-config";
import type { AuthorityDecision } from "@/lib/agent/authority-policy";
import {
  attestationFromHarnessText,
  formatTrustedEconomicAttestationForPrompt,
  type TrustedEconomicAttestation,
} from "@/lib/agent/economic-attestation";
import { planEconomicEffects } from "@/lib/agent/economic-authority";
import type { EconomicAuthorityLimits } from "@/lib/agent/economic-authority-limits";
import {
  economicIntentToJson,
  type FinalEconomicIntent,
} from "@/lib/agent/economic-intent";
import {
  createAwaitingWalletInteraction,
  findActiveEconomicInteractionForAuthor,
  updateEconomicInteraction,
} from "@/lib/agent/economic-interaction-persist";
import type { EconomicInteractionRow } from "@/lib/agent/economic-interaction";
import {
  planEconomicCompletionFollowup,
} from "@/lib/agent/economic-completion-plan";
import {
  stage12EconomicFollowupReplyIdempotencyKey,
} from "@/lib/agent/economic-followup";
import {
  assertP1b2DisposableRailReady,
  assertP1b2OfficialFennAbsent,
  harnessPurseState,
  planP1bEconomicOnlyDecision,
} from "@/lib/agent/p1b-economic-judgement-test";
import { parseStage124FinalJudgementModelOutput } from "@/lib/agent/stage124-final-judgement-helpers";
import { stage124FinalJudgementModelSchema } from "@/lib/agent/stage124-final-judgement-schema";
import { AgentJudgeError } from "@/lib/agent/judge-errors";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  sanitizeHarnessProviderFailure,
  type HarnessProviderFailure,
} from "@/lib/agent/p1b-harness-provider-error";
import { InMemoryEconomicInteractionStore } from "@/lib/agent/p1d-wallet-collection-test";
import {
  formatPurseEconomicStateForPrompt,
} from "@/lib/agent/purse-economic-context";
import { runFennPublicFinalJudgement } from "@/lib/agent/stage124-final-judge-model";
import type { Stage124FinalJudgeModelCaller } from "@/lib/agent/stage124-final-judge-model";
import {
  planTransferFromConfirmedInteraction,
  processAuthorWalletCollectionTurn,
} from "@/lib/agent/wallet-collection-handler";
import { decideWalletCollectionTurn } from "@/lib/agent/wallet-collection-turn";
import {
  renderWalletCollectionSpeech,
  type WalletSpeechModelCaller,
} from "@/lib/agent/wallet-speech";
import {
  speechFactsDestinationRequired,
  type WalletSpeechFacts,
} from "@/lib/agent/wallet-speech-facts";
import { explorerTxUrl } from "@/lib/greenwood/hollow/explorer";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import {
  resolveEconomicInteractionTtlMs,
} from "@/lib/agent/economic-interaction";
import type { EconomicCompletionSpeechModelCaller } from "@/lib/agent/economic-completion-speech";

// ---------------------------------------------------------------------------
// Identity (deterministic per operation label)
// ---------------------------------------------------------------------------

export function mvpRehearsalAuthorXUserId(operationLabel: string): string {
  const dig = createHash("sha256")
    .update(`mvp-rehearsal-author:${operationLabel.trim()}`)
    .digest("hex");
  return `9107${dig.slice(0, 15)}`;
}

export function mvpRehearsalXPostId(
  operationLabel: string,
  turn: "origin" | "wallet" | "confirm" | "burn",
): string {
  const dig = createHash("sha256")
    .update(`mvp-rehearsal-post:${operationLabel.trim()}:${turn}`)
    .digest("hex");
  const n = Number.parseInt(dig.slice(0, 12), 16) % 1e15;
  const prefix =
    turn === "origin"
      ? "91080"
      : turn === "wallet"
        ? "91081"
        : turn === "confirm"
          ? "91082"
          : "91083";
  return `${prefix}${String(n).padStart(14, "0")}`;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type MvpRehearsalTurn = {
  stage: string;
  xPostId: string | null;
  input: string;
  interactionStatus: string | null;
  speech: string | null;
  speechFallbackUsed: boolean | null;
  trustedState?: Record<string, unknown>;
  kind?: string;
};

export type MvpRehearsalResult = {
  ok: boolean;
  status:
    | "no_economic_action"
    | "economic_refused"
    | "dry_run_complete"
    | "awaiting_wallet_input"
    | "awaiting_confirmation_input"
    | "wallet_flow_failed"
    | "completed"
    | "already_completed"
    | "ambiguous"
    | "failed"
    | "scaffold_failed";
  mode: "FULL_DISPOSABLE_REHEARSAL";
  operationLabel: string;
  syntheticXUserId: string;
  untrustedText: string;
  trustedWalletAtJudgement: false;
  modelEconomicAction: FinalEconomicIntent | null;
  proposedAmount: string | null;
  economicReason: string | null;
  turns: MvpRehearsalTurn[];
  economicInteractionId: string | null;
  confirmedWallet: string | null;
  authorityOutcome: string | null;
  authorityRefusalReason: string | null;
  economicEffectId: string | null;
  purseOperationId: string | null;
  settlementStatus: string | null;
  amountFormatted: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  isTest: boolean | null;
  completionSpeech: string | null;
  completionSpeechFallbackUsed: boolean | null;
  completionReplyTarget: string | null;
  completionIdempotencyKey: string | null;
  chainBroadcastAttempted: boolean;
  liveXPostAttempted: false;
  executeTest: boolean;
  dryRun: boolean;
  errorCode: string | null;
  providerFailure?: HarnessProviderFailure | null;
  durationMs: number;
};

function emptyResult(
  partial: Partial<MvpRehearsalResult> &
    Pick<
      MvpRehearsalResult,
      | "ok"
      | "status"
      | "operationLabel"
      | "syntheticXUserId"
      | "untrustedText"
      | "durationMs"
      | "executeTest"
      | "dryRun"
    >,
): MvpRehearsalResult {
  return {
    mode: "FULL_DISPOSABLE_REHEARSAL",
    trustedWalletAtJudgement: false,
    modelEconomicAction: null,
    proposedAmount: null,
    economicReason: null,
    turns: [],
    economicInteractionId: null,
    confirmedWallet: null,
    authorityOutcome: null,
    authorityRefusalReason: null,
    economicEffectId: null,
    purseOperationId: null,
    settlementStatus: null,
    amountFormatted: null,
    txHash: null,
    explorerUrl: null,
    isTest: true,
    completionSpeech: null,
    completionSpeechFallbackUsed: null,
    completionReplyTarget: null,
    completionIdempotencyKey: null,
    chainBroadcastAttempted: false,
    liveXPostAttempted: false,
    errorCode: null,
    ...partial,
  };
}

/** Default real Stage 12.4 OpenAI caller (same path as P1B calibration). */
async function defaultRehearsalJudgeCaller(args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}): Promise<import("@/lib/agent/stage124-final-judgement-schema").Stage124FinalJudgementModelOutput> {
  const { getOpenAIClient, OpenAIUnavailableError } = await import(
    "@/lib/ai/openai"
  );
  let client;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof OpenAIUnavailableError) {
      throw Object.assign(
        new AgentJudgeError(
          "judge_model_unavailable",
          "Final judgement model is not configured",
          503,
        ),
        {
          harnessProviderFailure: sanitizeHarnessProviderFailure(error),
        },
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
      throw new Error("final judgement model returned no result");
    }
    return parseStage124FinalJudgementModelOutput(parsed);
  } catch (error) {
    const dig = sanitizeHarnessProviderFailure(error);
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

async function resolveAdmin(
  admin?: SupabaseClient,
): Promise<SupabaseClient> {
  if (admin) return admin;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const client = createAdminClient();
  if (!client) throw new Error("mvp_rehearsal_admin_unavailable");
  return client;
}

async function ensurePerceptionScaffold(input: {
  db: SupabaseClient;
  xPostId: string;
  authorXUserId: string;
  body: string;
  username: string;
}): Promise<string> {
  const { data: existing } = await input.db
    .from("x_perception_events")
    .select("id")
    .eq("x_post_id", input.xPostId)
    .maybeSingle();
  if (existing?.id) return String(existing.id);

  const insert = await input.db
    .from("x_perception_events")
    .insert({
      x_post_id: input.xPostId,
      perception_type: "mention",
      author_x_user_id: input.authorXUserId,
      author_username: input.username,
      author_display_name: "MVP Rehearsal User",
      body: input.body,
      conversation_id: null,
      referenced_tweet_ids: [],
      x_created_at: new Date().toISOString(),
      status: "processed",
      processed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insert.error || !insert.data) {
    const retry = await input.db
      .from("x_perception_events")
      .select("id")
      .eq("x_post_id", input.xPostId)
      .maybeSingle();
    if (retry.error || !retry.data) {
      throw new Error(`mvp_event_insert_failed:${insert.error?.message ?? ""}`);
    }
    return String(retry.data.id);
  }
  return String(insert.data.id);
}

async function ensureJudgementScaffold(input: {
  db: SupabaseClient;
  perceptionEventId: string;
  speechAction: string;
  reasonCode: string;
  replyText: string | null;
  economicIntent: FinalEconomicIntent;
}): Promise<string> {
  const { data: existing } = await input.db
    .from("x_perception_judgements")
    .select("id")
    .eq("perception_event_id", input.perceptionEventId)
    .maybeSingle();
  if (existing?.id) return String(existing.id);

  const insert = await input.db
    .from("x_perception_judgements")
    .insert({
      perception_event_id: input.perceptionEventId,
      action: input.speechAction,
      reason_code: input.reasonCode,
      engage: true,
      reply_text: input.replyText,
      wall_body: null,
      needs_live_state: [],
      identity_unverified: false,
      knowledge_available: true,
      model: "mvp-rehearsal",
      prompt_version: "mvp-rehearsal-v1",
      final_status: "finalized",
      live_state_available: true,
      live_state_succeeded: [],
      live_state_failed: [],
      finalized_at: new Date().toISOString(),
      final_action: "do_nothing",
      final_reason_code: input.reasonCode,
      final_engage: false,
      final_reply_text: input.replyText,
      final_wall_body: null,
      final_identity_unverified: false,
      final_model: "mvp-rehearsal",
      final_prompt_version: "mvp-rehearsal-v1",
      final_economic_intent: economicIntentToJson(input.economicIntent),
    })
    .select("id")
    .single();

  if (insert.error || !insert.data) {
    const retry = await input.db
      .from("x_perception_judgements")
      .select("id")
      .eq("perception_event_id", input.perceptionEventId)
      .maybeSingle();
    if (retry.error || !retry.data) {
      throw new Error(
        `mvp_judgement_insert_failed:${insert.error?.message ?? ""}`,
      );
    }
    return String(retry.data.id);
  }
  return String(insert.data.id);
}

function inMemoryInsertAwaiting(input: {
  store: InMemoryEconomicInteractionStore;
  authorXUserId: string;
  sourceXPostId: string;
  originPerceptionEventId: string;
  originJudgementId: string | null;
  proposedAmount: string;
  economicReason: string;
}): EconomicInteractionRow {
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + resolveEconomicInteractionTtlMs(),
  ).toISOString();
  return input.store.insert({
    id: randomUUID(),
    authorXUserId: input.authorXUserId,
    sourceXPostId: input.sourceXPostId,
    originPerceptionEventId: input.originPerceptionEventId,
    originJudgementId: input.originJudgementId,
    xConversationId: null,
    economicActionType: "transfer_fenn",
    proposedAmount: input.proposedAmount,
    economicReason: input.economicReason,
    status: "awaiting_wallet",
    candidateWallet: null,
    confirmedWallet: null,
    candidateSourceXPostId: null,
    confirmationSourceXPostId: null,
    transferEffectId: null,
    lastError: null,
    walletRequestedAt: nowIso,
    walletReceivedAt: null,
    walletConfirmationRequestedAt: null,
    walletConfirmedAt: null,
    expiresAt,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

/**
 * Dry-run wallet turn using the same FSM + Book-of-Speech path as production,
 * with an in-memory interaction store.
 */
async function processInMemoryWalletTurn(input: {
  store: InMemoryEconomicInteractionStore;
  authorXUserId: string;
  xPostId: string;
  body: string;
  forceSpeechFallback?: boolean;
  callWalletSpeechModel?: WalletSpeechModelCaller;
}): Promise<{
  interaction: EconomicInteractionRow | null;
  replyText: string | null;
  speechFallbackUsed: boolean | null;
  kind: string;
  speechFacts: WalletSpeechFacts | null;
  reenter: boolean;
}> {
  const interaction = input.store.findActive(input.authorXUserId);
  if (!interaction) {
    return {
      interaction: null,
      replyText: null,
      speechFallbackUsed: null,
      kind: "no_active",
      speechFacts: null,
      reenter: false,
    };
  }

  const decision = decideWalletCollectionTurn({
    interaction,
    authorXUserId: input.authorXUserId,
    body: input.body,
  });

  async function speak(facts: WalletSpeechFacts) {
    return renderWalletCollectionSpeech({
      facts,
      untrustedUserBody: input.body,
      callModel: input.callWalletSpeechModel,
      forceFallback: input.forceSpeechFallback,
    });
  }

  if (decision.kind === "ignored_wrong_user") {
    return {
      interaction,
      replyText: null,
      speechFallbackUsed: null,
      kind: decision.kind,
      speechFacts: null,
      reenter: false,
    };
  }

  if (decision.kind === "expired") {
    input.store.update(interaction.id, {
      status: "expired",
      lastError: "expired",
    });
    const rendered = await speak(decision.speechFacts);
    return {
      interaction: input.store.get(interaction.id),
      replyText: rendered.replyText,
      speechFallbackUsed: rendered.usedFallback,
      kind: decision.kind,
      speechFacts: decision.speechFacts,
      reenter: false,
    };
  }

  if (
    decision.kind === "remain_awaiting_wallet" ||
    decision.kind === "ambiguous_confirmation"
  ) {
    const rendered = await speak(decision.speechFacts);
    return {
      interaction,
      replyText: rendered.replyText,
      speechFallbackUsed: rendered.usedFallback,
      kind: decision.kind,
      speechFacts: decision.speechFacts,
      reenter: false,
    };
  }

  if (decision.kind === "candidate_set" || decision.kind === "candidate_replaced") {
    const next = input.store.update(interaction.id, {
      status: decision.nextStatus,
      candidateWallet: decision.candidateWallet,
      candidateSourceXPostId: input.xPostId,
      walletReceivedAt: new Date().toISOString(),
      walletConfirmationRequestedAt: new Date().toISOString(),
      confirmedWallet: null,
      confirmationSourceXPostId: null,
      walletConfirmedAt: null,
    });
    const rendered = await speak(decision.speechFacts);
    return {
      interaction: next,
      replyText: rendered.replyText,
      speechFallbackUsed: rendered.usedFallback,
      kind: decision.kind,
      speechFacts: decision.speechFacts,
      reenter: false,
    };
  }

  if (decision.kind === "back_to_awaiting_wallet") {
    const next = input.store.update(interaction.id, {
      status: decision.nextStatus,
      candidateWallet: null,
      candidateSourceXPostId: null,
      confirmedWallet: null,
      confirmationSourceXPostId: null,
    });
    const rendered = await speak(decision.speechFacts);
    return {
      interaction: next,
      replyText: rendered.replyText,
      speechFallbackUsed: rendered.usedFallback,
      kind: decision.kind,
      speechFacts: decision.speechFacts,
      reenter: false,
    };
  }

  if (decision.kind === "confirmed") {
    const next = input.store.update(interaction.id, {
      status: decision.nextStatus,
      confirmedWallet: decision.confirmedWallet,
      candidateWallet: decision.confirmedWallet,
      confirmationSourceXPostId: input.xPostId,
      walletConfirmedAt: new Date().toISOString(),
    });
    const rendered = await speak(decision.speechFacts);
    return {
      interaction: next,
      replyText: rendered.replyText,
      speechFallbackUsed: rendered.usedFallback,
      kind: decision.kind,
      speechFacts: decision.speechFacts,
      reenter: true,
    };
  }

  return {
    interaction,
    replyText: null,
    speechFallbackUsed: null,
    kind: decision.kind,
    speechFacts: null,
    reenter: false,
  };
}

async function completePreviewFromSettlement(input: {
  actionType: "transfer" | "burn";
  amountFormatted: string;
  txHash: string;
  confirmedAt: string;
  isTest: boolean;
  economicEffectId: string;
  sourceXPostId: string;
  recipientAddress?: string | null;
  forceSpeechFallback?: boolean;
  callCompletionSpeechModel?: EconomicCompletionSpeechModelCaller;
}): Promise<{
  speech: string | null;
  fallback: boolean | null;
  replyTarget: string | null;
  idempotencyKey: string;
}> {
  // Always dryRun / no persist — rehearsal never posts live X by default.
  const plan = await planEconomicCompletionFollowup({
    actionType: input.actionType,
    amountFormatted: input.amountFormatted,
    txHash: input.txHash,
    confirmedAt: input.confirmedAt,
    isTest: input.isTest,
    economicEffectId: input.economicEffectId,
    sourceXPostId: input.sourceXPostId,
    authorizationId: "00000000-0000-0000-0000-0000000000a1",
    perceptionEventId: "00000000-0000-0000-0000-0000000000a2",
    recipientAddress: input.recipientAddress,
    dryRun: true,
    forceSpeechFallback: input.forceSpeechFallback,
    callSpeechModel: input.callCompletionSpeechModel,
  });
  return {
    speech: plan.speech?.replyText ?? null,
    fallback: plan.speech?.usedFallback ?? null,
    replyTarget: plan.facts?.replyToXPostId ?? input.sourceXPostId,
    idempotencyKey:
      plan.idempotencyKey ??
      stage12EconomicFollowupReplyIdempotencyKey(input.economicEffectId),
  };
}

async function loadCompletedEffectForPost(input: {
  db: SupabaseClient;
  xPostId: string;
}): Promise<{
  effectId: string;
  effectType: string;
  status: string;
  externalResultId: string | null;
  amountFormatted: string | null;
  recipientAddress: string | null;
} | null> {
  const { data: event } = await input.db
    .from("x_perception_events")
    .select("id")
    .eq("x_post_id", input.xPostId)
    .maybeSingle();
  if (!event?.id) return null;

  const { data: effects } = await input.db
    .from("x_perception_effects")
    .select("id, effect_type, type, status, external_result_id, payload")
    .eq("perception_event_id", event.id);

  const rows = effects ?? [];
  for (const e of rows) {
    const r = e as Record<string, unknown>;
    const t = String(r.effect_type ?? r.type ?? "");
    if (t !== "transfer_fenn" && t !== "burn_fenn") continue;
    const status = String(r.status ?? "");
    if (status !== "completed") continue;
    const payload =
      r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
        ? (r.payload as Record<string, unknown>)
        : {};
    return {
      effectId: String(r.id),
      effectType: t,
      status,
      externalResultId:
        typeof r.external_result_id === "string" ? r.external_result_id : null,
      amountFormatted:
        typeof payload.amountFormatted === "string"
          ? payload.amountFormatted
          : null,
      recipientAddress:
        typeof payload.recipientAddress === "string"
          ? payload.recipientAddress
          : null,
    };
  }
  return null;
}

/**
 * Full MVP economic flow rehearsal.
 * Never uses force-intent. Wallet CLI flags are user turns only.
 */
export async function runMvpEconomicRehearsal(input: {
  operationLabel: string;
  text: string;
  /** Optional operator attestation for Stage 12.4 — never injects wallet trust. */
  attestation?: TrustedEconomicAttestation | null;
  referenceId?: string | null;
  trustedFact?: string | null;
  /** User turn 1 body (wallet). Not trusted at judgement. */
  walletText?: string | null;
  /** User turn 2 body (confirmation). Default "yes". */
  confirmText?: string | null;
  /** Real disposable chain via Stage 12.6. */
  executeTest?: boolean;
  dryRun?: boolean;
  admin?: SupabaseClient;
  callModel?: Stage124FinalJudgeModelCaller;
  callWalletSpeechModel?: WalletSpeechModelCaller;
  callCompletionSpeechModel?: EconomicCompletionSpeechModelCaller;
  forceSpeechFallback?: boolean;
  /** Test-only limits override (must not clamp — refuse path only). */
  limits?: EconomicAuthorityLimits;
  env?: NodeJS.ProcessEnv;
  executeEffect?: typeof import("@/lib/agent/stage126-execute").executeOneXPerceptionEffect;
  loadOfficialFenn?: () => Promise<unknown>;
  memoryStore?: InMemoryEconomicInteractionStore;
}): Promise<MvpRehearsalResult> {
  const started = Date.now();
  const operationLabel = input.operationLabel.trim();
  const text = input.text.slice(0, 2000);
  const executeTest = input.executeTest === true;
  const dryRun = executeTest ? false : input.dryRun !== false;
  const authorXUserId = mvpRehearsalAuthorXUserId(operationLabel);
  const originXPostId = mvpRehearsalXPostId(operationLabel, "origin");
  const walletXPostId = mvpRehearsalXPostId(operationLabel, "wallet");
  const confirmXPostId = mvpRehearsalXPostId(operationLabel, "confirm");
  const burnXPostId = mvpRehearsalXPostId(operationLabel, "burn");
  const walletText = (input.walletText ?? "").trim();
  const confirmText = (input.confirmText ?? "yes").trim() || "yes";
  const forceSpeechFallback = input.forceSpeechFallback === true;
  const env = input.env ?? process.env;
  const turns: MvpRehearsalTurn[] = [];
  const purseState = harnessPurseState();
  const purseBlock = formatPurseEconomicStateForPrompt(purseState);

  let attestation: TrustedEconomicAttestation | null =
    input.attestation ?? null;
  if (!attestation && input.trustedFact?.trim()) {
    attestation = attestationFromHarnessText({
      referenceId: input.referenceId?.trim() || `rehearsal-${operationLabel}`,
      summary: input.trustedFact.trim(),
    });
  }
  const attestationBlock =
    formatTrustedEconomicAttestationForPrompt(attestation);

  try {
    if (!operationLabel) {
      return emptyResult({
        ok: false,
        status: "failed",
        operationLabel: "",
        syntheticXUserId: authorXUserId,
        untrustedText: text,
        executeTest,
        dryRun,
        errorCode: "operation_label_required",
        durationMs: Date.now() - started,
      });
    }

    if (executeTest) {
      try {
        assertP1b2DisposableRailReady(env);
        await assertP1b2OfficialFennAbsent(input.loadOfficialFenn);
      } catch (error) {
        return emptyResult({
          ok: false,
          status: "failed",
          operationLabel,
          syntheticXUserId: authorXUserId,
          untrustedText: text,
          executeTest,
          dryRun: true,
          errorCode:
            error instanceof Error
              ? error.message.slice(0, 120)
              : "test_rail_refused",
          durationMs: Date.now() - started,
        });
      }
    }

    // ------------------------------------------------------------------
    // TURN 0 — real Stage 12.4 judgement (never inject trusted wallet)
    // ------------------------------------------------------------------
    const intention = await runFennPublicFinalJudgement({
      xPostId: originXPostId,
      perceptionType: "mention",
      authorXUserId,
      authorUsername: "mvp_rehearsal_user",
      body: text,
      knowledgeAvailable: true,
      knowledgeContext: null,
      trustedLiveStateBlock:
        "No additional live public-fact reads for this harness run. Prefer TRUSTED ECONOMIC ATTESTATION and THE PURSE when judging economy.",
      liveStateAnyAvailable: true,
      trustedPurseStateBlock: purseBlock,
      trustedWalletAvailable: false,
      trustedEconomicAttestationBlock: attestationBlock,
      callModel: input.callModel ?? defaultRehearsalJudgeCaller,
    });

    const modelEconomicAction = intention.economicIntent;
    const proposedAmount =
      modelEconomicAction.type === "NONE"
        ? null
        : modelEconomicAction.proposedAmount;
    const economicReason =
      modelEconomicAction.type === "NONE" ? null : modelEconomicAction.reason;

    turns.push({
      stage: "turn0_judgement",
      xPostId: originXPostId,
      input: text,
      interactionStatus: null,
      speech: intention.replyText,
      speechFallbackUsed: false,
      kind: modelEconomicAction.type,
      trustedState: {
        trustedWalletAvailable: false,
        economicAction: modelEconomicAction,
        speechAction: intention.action,
      },
    });

    if (modelEconomicAction.type === "NONE") {
      return emptyResult({
        ok: true,
        status: "no_economic_action",
        operationLabel,
        syntheticXUserId: authorXUserId,
        untrustedText: text,
        modelEconomicAction,
        proposedAmount,
        economicReason,
        turns,
        executeTest,
        dryRun,
        durationMs: Date.now() - started,
      });
    }

    // Initial authority plan WITHOUT destination trust — transfer expects pending_destination.
    const provisionalPerceptionId = `pe-mvp-${operationLabel}`;
    const initialPlan = planEconomicEffects({
      economicIntent: modelEconomicAction,
      reasonCode: intention.reasonCode,
      perceptionEventId: provisionalPerceptionId,
      harnessBoundWallet: null,
      purseState,
      executionRail: "p1a_test",
      sufficientBalance: true,
      limits: input.limits,
    });

    // Authority refused (amount limits, etc.) — no clamp, no re-judge.
    if (
      initialPlan.skippedReason &&
      !initialPlan.pendingDestination &&
      initialPlan.effects.length === 0
    ) {
      // burns that plan effects are not refuse
      if (modelEconomicAction.type === "burn_fenn" && initialPlan.effects.length > 0) {
        // continue below
      } else if (modelEconomicAction.type === "transfer_fenn") {
        return emptyResult({
          ok: true,
          status: "economic_refused",
          operationLabel,
          syntheticXUserId: authorXUserId,
          untrustedText: text,
          modelEconomicAction,
          proposedAmount,
          economicReason,
          turns,
          authorityOutcome: "blocked",
          authorityRefusalReason: initialPlan.skippedReason,
          executeTest,
          dryRun,
          durationMs: Date.now() - started,
        });
      }
    }

    // ===================== BURN PATH (no wallet FSM) =====================
    if (modelEconomicAction.type === "burn_fenn") {
      if (initialPlan.effects.length === 0) {
        return emptyResult({
          ok: true,
          status: "economic_refused",
          operationLabel,
          syntheticXUserId: authorXUserId,
          untrustedText: text,
          modelEconomicAction,
          proposedAmount,
          economicReason,
          turns,
          authorityOutcome: "blocked",
          authorityRefusalReason: initialPlan.skippedReason,
          executeTest,
          dryRun,
          durationMs: Date.now() - started,
        });
      }

      if (!executeTest) {
        return emptyResult({
          ok: true,
          status: "dry_run_complete",
          operationLabel,
          syntheticXUserId: authorXUserId,
          untrustedText: text,
          modelEconomicAction,
          proposedAmount,
          economicReason,
          turns,
          authorityOutcome: "permitted",
          authorityRefusalReason: null,
          amountFormatted: proposedAmount,
          settlementStatus: null,
          executeTest,
          dryRun: true,
          durationMs: Date.now() - started,
        });
      }

      const db = await resolveAdmin(input.admin);
      // Already completed? Reuse settlement — never rebroadcast.
      const prior = await loadCompletedEffectForPost({
        db,
        xPostId: burnXPostId,
      });
      if (prior?.externalResultId) {
        const completion = await completePreviewFromSettlement({
          actionType: "burn",
          amountFormatted: prior.amountFormatted ?? proposedAmount ?? "0",
          txHash: prior.externalResultId,
          confirmedAt: new Date().toISOString(),
          isTest: true,
          economicEffectId: prior.effectId,
          sourceXPostId: burnXPostId,
          forceSpeechFallback,
          callCompletionSpeechModel: input.callCompletionSpeechModel,
        });
        return emptyResult({
          ok: true,
          status: "already_completed",
          operationLabel,
          syntheticXUserId: authorXUserId,
          untrustedText: text,
          modelEconomicAction,
          proposedAmount,
          economicReason,
          turns,
          authorityOutcome: "permitted",
          economicEffectId: prior.effectId,
          purseOperationId: stage12BurnPurseOperationId(prior.effectId),
          settlementStatus: "confirmed",
          amountFormatted: prior.amountFormatted ?? proposedAmount,
          txHash: prior.externalResultId,
          explorerUrl: explorerTxUrl(ROBINHOOD_CHAIN_ID, prior.externalResultId),
          isTest: true,
          completionSpeech: completion.speech,
          completionSpeechFallbackUsed: completion.fallback,
          completionReplyTarget: completion.replyTarget,
          completionIdempotencyKey: completion.idempotencyKey,
          chainBroadcastAttempted: false,
          executeTest,
          dryRun: false,
          durationMs: Date.now() - started,
        });
      }

      const perceptionEventId = await ensurePerceptionScaffold({
        db,
        xPostId: burnXPostId,
        authorXUserId,
        body: text,
        username: "mvp_rehearsal_burn",
      });
      const judgementId = await ensureJudgementScaffold({
        db,
        perceptionEventId,
        speechAction: intention.action,
        reasonCode: intention.reasonCode,
        replyText: intention.replyText,
        economicIntent: modelEconomicAction,
      });

      const decision = planP1bEconomicOnlyDecision({
        perceptionEventId,
        xPostId: burnXPostId,
        reasonCode: intention.reasonCode,
        economicIntent: modelEconomicAction,
        trustedWallet: null,
        purseState,
      });
      // Re-plan with limits if injected
      const burnPlanned = planEconomicEffects({
        economicIntent: modelEconomicAction,
        reasonCode: intention.reasonCode,
        perceptionEventId,
        harnessBoundWallet: null,
        purseState,
        executionRail: "p1a_test",
        sufficientBalance: true,
        limits: input.limits,
      });
      const persistDecision: AuthorityDecision = {
        ...decision,
        effects: burnPlanned.effects,
        outcome: burnPlanned.effects.length ? "permitted" : "no_action",
        policyCode: burnPlanned.policyHint ?? decision.policyCode,
        finalAction: "do_nothing",
        sourceXPostId: burnXPostId,
        policyVersion: STAGE125_POLICY_VERSION,
      };

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

      const executeOne =
        input.executeEffect ??
        (await import("@/lib/agent/stage126-execute")).executeOneXPerceptionEffect;
      const one = await executeOne(
        { xPostId: burnXPostId, dryRun: false },
        { admin: db as never },
      );

      const effectId = one.effectId ?? null;
      const signed =
        one.status === "completed" ||
        one.status === "already_completed_skipped";
      let status: MvpRehearsalResult["status"] = "failed";
      if (one.status === "completed") status = "completed";
      else if (one.status === "already_completed_skipped") {
        status = "already_completed";
      } else if (one.failureClass === "ambiguous") status = "ambiguous";

      let completionSpeech: string | null = one.economicFollowupPreview ?? null;
      let completionFallback: boolean | null = null;
      let completionTarget: string | null = burnXPostId;
      let completionKey: string | null = effectId
        ? stage12EconomicFollowupReplyIdempotencyKey(effectId)
        : null;

      if (signed && one.externalResultId && effectId) {
        // Re-preview with dryRun so live X is never attempted by this harness.
        const c = await completePreviewFromSettlement({
          actionType: "burn",
          amountFormatted: proposedAmount ?? "0",
          txHash: one.externalResultId,
          confirmedAt: new Date().toISOString(),
          isTest: true,
          economicEffectId: effectId,
          sourceXPostId: burnXPostId,
          forceSpeechFallback,
          callCompletionSpeechModel: input.callCompletionSpeechModel,
        });
        completionSpeech = c.speech;
        completionFallback = c.fallback;
        completionTarget = c.replyTarget;
        completionKey = c.idempotencyKey;
      }

      return emptyResult({
        ok: status === "completed" || status === "already_completed" || status === "ambiguous",
        status,
        operationLabel,
        syntheticXUserId: authorXUserId,
        untrustedText: text,
        modelEconomicAction,
        proposedAmount,
        economicReason,
        turns,
        authorityOutcome: "permitted",
        economicEffectId: effectId,
        purseOperationId: effectId
          ? stage12BurnPurseOperationId(effectId)
          : null,
        settlementStatus: signed ? "confirmed" : one.failureClass ?? one.status,
        amountFormatted: proposedAmount,
        txHash: one.externalResultId ?? null,
        explorerUrl: one.externalResultId
          ? explorerTxUrl(ROBINHOOD_CHAIN_ID, one.externalResultId)
          : null,
        isTest: true,
        completionSpeech,
        completionSpeechFallbackUsed: completionFallback,
        completionReplyTarget: completionTarget,
        completionIdempotencyKey: completionKey,
        chainBroadcastAttempted: signed || one.status === "failed",
        executeTest,
        dryRun: false,
        errorCode: one.errorCode ?? null,
        durationMs: Date.now() - started,
      });
    }

    // ===================== TRANSFER PATH (requires P1D) =====================
    if (modelEconomicAction.type !== "transfer_fenn") {
      return emptyResult({
        ok: false,
        status: "failed",
        operationLabel,
        syntheticXUserId: authorXUserId,
        untrustedText: text,
        modelEconomicAction,
        turns,
        executeTest,
        dryRun,
        errorCode: "unexpected_intent_type",
        durationMs: Date.now() - started,
      });
    }

    // Must be pending destination (no trusted wallet at judgement).
    if (
      !initialPlan.pendingDestination &&
      initialPlan.skippedReason !== "pending_destination"
    ) {
      if (initialPlan.effects.length > 0) {
        // Unexpected — never inject harness wallet; refuse unsafe auto-transfer.
        return emptyResult({
          ok: false,
          status: "failed",
          operationLabel,
          syntheticXUserId: authorXUserId,
          untrustedText: text,
          modelEconomicAction,
          proposedAmount,
          economicReason,
          turns,
          errorCode: "unexpected_transfer_without_pending_destination",
          executeTest,
          dryRun,
          durationMs: Date.now() - started,
        });
      }
      return emptyResult({
        ok: true,
        status: "economic_refused",
        operationLabel,
        syntheticXUserId: authorXUserId,
        untrustedText: text,
        modelEconomicAction,
        proposedAmount,
        economicReason,
        turns,
        authorityOutcome: "blocked",
        authorityRefusalReason: initialPlan.skippedReason,
        executeTest,
        dryRun,
        durationMs: Date.now() - started,
      });
    }

    const amountLocked = modelEconomicAction.proposedAmount;
    const reasonLocked = modelEconomicAction.reason;

    // Create / resume interaction
    let interaction: EconomicInteractionRow | null = null;
    let originPerceptionEventId: string = provisionalPerceptionId;
    let originJudgementId: string | null = null;
    const memoryStore = input.memoryStore ?? new InMemoryEconomicInteractionStore();

    if (executeTest) {
      const db = await resolveAdmin(input.admin);
      originPerceptionEventId = await ensurePerceptionScaffold({
        db,
        xPostId: originXPostId,
        authorXUserId,
        body: text,
        username: "mvp_rehearsal_origin",
      });
      originJudgementId = await ensureJudgementScaffold({
        db,
        perceptionEventId: originPerceptionEventId,
        speechAction: intention.action,
        reasonCode: intention.reasonCode,
        replyText: intention.replyText,
        economicIntent: modelEconomicAction,
      });

      // Resume active interaction for this synthetic user (idempotent re-run).
      const active = await findActiveEconomicInteractionForAuthor({
        authorXUserId,
        admin: db,
      });
      if (active) {
        interaction = active;
      } else {
        // If previously completed, look for completed confirm-post effect.
        const prior = await loadCompletedEffectForPost({
          db,
          xPostId: confirmXPostId,
        });
        if (prior?.externalResultId) {
          const completion = await completePreviewFromSettlement({
            actionType: "transfer",
            amountFormatted: prior.amountFormatted ?? amountLocked,
            txHash: prior.externalResultId,
            confirmedAt: new Date().toISOString(),
            isTest: true,
            economicEffectId: prior.effectId,
            sourceXPostId: confirmXPostId,
            recipientAddress: prior.recipientAddress,
            forceSpeechFallback,
            callCompletionSpeechModel: input.callCompletionSpeechModel,
          });
          return emptyResult({
            ok: true,
            status: "already_completed",
            operationLabel,
            syntheticXUserId: authorXUserId,
            untrustedText: text,
            modelEconomicAction,
            proposedAmount: amountLocked,
            economicReason: reasonLocked,
            turns,
            confirmedWallet: prior.recipientAddress,
            economicEffectId: prior.effectId,
            purseOperationId: stage12TransferPurseOperationId(prior.effectId),
            settlementStatus: "confirmed",
            amountFormatted: prior.amountFormatted ?? amountLocked,
            txHash: prior.externalResultId,
            explorerUrl: explorerTxUrl(
              ROBINHOOD_CHAIN_ID,
              prior.externalResultId,
            ),
            isTest: true,
            completionSpeech: completion.speech,
            completionSpeechFallbackUsed: completion.fallback,
            completionReplyTarget: completion.replyTarget,
            completionIdempotencyKey: completion.idempotencyKey,
            chainBroadcastAttempted: false,
            executeTest,
            dryRun: false,
            durationMs: Date.now() - started,
          });
        }

        const created = await createAwaitingWalletInteraction({
          authorXUserId,
          sourceXPostId: originXPostId,
          originPerceptionEventId,
          originJudgementId,
          proposedAmount: amountLocked,
          economicReason: reasonLocked,
          admin: db,
        });
        if (!created.ok) {
          return emptyResult({
            ok: false,
            status: "scaffold_failed",
            operationLabel,
            syntheticXUserId: authorXUserId,
            untrustedText: text,
            modelEconomicAction,
            proposedAmount: amountLocked,
            economicReason: reasonLocked,
            turns,
            errorCode: `interaction_create_${created.reason}`,
            executeTest,
            dryRun: false,
            durationMs: Date.now() - started,
          });
        }
        interaction = created.interaction;
      }
    } else {
      const existing = memoryStore.findActive(authorXUserId);
      interaction =
        existing ??
        inMemoryInsertAwaiting({
          store: memoryStore,
          authorXUserId,
          sourceXPostId: originXPostId,
          originPerceptionEventId,
          originJudgementId: null,
          proposedAmount: amountLocked,
          economicReason: reasonLocked,
        });
    }

    // Wallet-request speech (turn 0 side effect of pending destination)
    const destFacts = speechFactsDestinationRequired(amountLocked);
    const destSpeech = await renderWalletCollectionSpeech({
      facts: destFacts,
      untrustedUserBody: text,
      callModel: input.callWalletSpeechModel,
      forceFallback: forceSpeechFallback,
    });
    turns.push({
      stage: "turn0_wallet_request",
      xPostId: originXPostId,
      input: "(destination required)",
      interactionStatus: interaction.status,
      speech: destSpeech.replyText,
      speechFallbackUsed: destSpeech.usedFallback,
      kind: "pending_destination",
      trustedState: {
        proposedAmount: amountLocked,
        economicReason: reasonLocked,
        interactionId: interaction.id,
        walletTrusted: false,
      },
    });

    // ------------------------------------------------------------------
    // TURN 1 — wallet body (untrusted until P1D confirms)
    // ------------------------------------------------------------------
    if (!walletText) {
      return emptyResult({
        ok: true,
        status: "awaiting_wallet_input",
        operationLabel,
        syntheticXUserId: authorXUserId,
        untrustedText: text,
        modelEconomicAction,
        proposedAmount: amountLocked,
        economicReason: reasonLocked,
        turns,
        economicInteractionId: interaction.id,
        authorityOutcome: "pending_destination",
        executeTest,
        dryRun,
        durationMs: Date.now() - started,
      });
    }

    let afterWallet: {
      interaction: EconomicInteractionRow | null;
      replyText: string | null;
      speechFallbackUsed: boolean | null;
      kind: string;
      reenter: boolean;
    };

    if (executeTest) {
      const db = await resolveAdmin(input.admin);
      await ensurePerceptionScaffold({
        db,
        xPostId: walletXPostId,
        authorXUserId,
        body: walletText,
        username: "mvp_rehearsal_wallet",
      });
      const handled = await processAuthorWalletCollectionTurn({
        authorXUserId,
        xPostId: walletXPostId,
        body: walletText,
        admin: db,
        callWalletSpeechModel: input.callWalletSpeechModel,
        forceSpeechFallback,
      });
      afterWallet = {
        interaction: handled.interaction,
        replyText: handled.replyText,
        speechFallbackUsed: handled.speechRender?.usedFallback ?? null,
        kind: handled.kind,
        reenter: Boolean(handled.reenterTransfer),
      };
    } else {
      afterWallet = await processInMemoryWalletTurn({
        store: memoryStore,
        authorXUserId,
        xPostId: walletXPostId,
        body: walletText,
        forceSpeechFallback,
        callWalletSpeechModel: input.callWalletSpeechModel,
      });
    }

    interaction = afterWallet.interaction ?? interaction;
    turns.push({
      stage: "turn1_wallet",
      xPostId: walletXPostId,
      input: walletText,
      interactionStatus: interaction?.status ?? null,
      speech: afterWallet.replyText,
      speechFallbackUsed: afterWallet.speechFallbackUsed,
      kind: afterWallet.kind,
      trustedState: {
        proposedAmount: amountLocked,
        candidateWallet: interaction?.candidateWallet ?? null,
        confirmedWallet: interaction?.confirmedWallet ?? null,
        amountUnchanged:
          interaction?.proposedAmount === amountLocked,
      },
    });

    if (
      !interaction ||
      interaction.status !== "awaiting_wallet_confirmation"
    ) {
      return emptyResult({
        ok: interaction?.status === "awaiting_wallet",
        status:
          interaction?.status === "awaiting_wallet"
            ? "awaiting_wallet_input"
            : "wallet_flow_failed",
        operationLabel,
        syntheticXUserId: authorXUserId,
        untrustedText: text,
        modelEconomicAction,
        proposedAmount: amountLocked,
        economicReason: reasonLocked,
        turns,
        economicInteractionId: interaction?.id ?? null,
        errorCode:
          interaction?.status === "awaiting_wallet"
            ? null
            : `wallet_turn_kind_${afterWallet.kind}`,
        executeTest,
        dryRun,
        durationMs: Date.now() - started,
      });
    }

    // ------------------------------------------------------------------
    // TURN 2 — confirm
    // ------------------------------------------------------------------
    let afterConfirm: {
      interaction: EconomicInteractionRow | null;
      replyText: string | null;
      speechFallbackUsed: boolean | null;
      kind: string;
      reenter: boolean;
    };

    if (executeTest) {
      const db = await resolveAdmin(input.admin);
      await ensurePerceptionScaffold({
        db,
        xPostId: confirmXPostId,
        authorXUserId,
        body: confirmText,
        username: "mvp_rehearsal_confirm",
      });
      const handled = await processAuthorWalletCollectionTurn({
        authorXUserId,
        xPostId: confirmXPostId,
        body: confirmText,
        admin: db,
        callWalletSpeechModel: input.callWalletSpeechModel,
        forceSpeechFallback,
      });
      afterConfirm = {
        interaction: handled.interaction,
        replyText: handled.replyText,
        speechFallbackUsed: handled.speechRender?.usedFallback ?? null,
        kind: handled.kind,
        reenter: Boolean(handled.reenterTransfer),
      };
    } else {
      afterConfirm = await processInMemoryWalletTurn({
        store: memoryStore,
        authorXUserId,
        xPostId: confirmXPostId,
        body: confirmText,
        forceSpeechFallback,
        callWalletSpeechModel: input.callWalletSpeechModel,
      });
    }

    interaction = afterConfirm.interaction ?? interaction;
    turns.push({
      stage: "turn2_confirm",
      xPostId: confirmXPostId,
      input: confirmText,
      interactionStatus: interaction?.status ?? null,
      speech: afterConfirm.replyText,
      speechFallbackUsed: afterConfirm.speechFallbackUsed,
      kind: afterConfirm.kind,
      trustedState: {
        proposedAmount: amountLocked,
        confirmedWallet: interaction?.confirmedWallet ?? null,
        amountUnchanged:
          interaction?.proposedAmount === amountLocked,
      },
    });

    if (
      !interaction ||
      interaction.status !== "wallet_confirmed" ||
      !interaction.confirmedWallet
    ) {
      return emptyResult({
        ok: false,
        status: "wallet_flow_failed",
        operationLabel,
        syntheticXUserId: authorXUserId,
        untrustedText: text,
        modelEconomicAction,
        proposedAmount: amountLocked,
        economicReason: reasonLocked,
        turns,
        economicInteractionId: interaction?.id ?? null,
        errorCode: `confirm_kind_${afterConfirm.kind}`,
        executeTest,
        dryRun,
        durationMs: Date.now() - started,
      });
    }

    // Amount must survive wallet turns (law).
    if (interaction.proposedAmount !== amountLocked) {
      return emptyResult({
        ok: false,
        status: "failed",
        operationLabel,
        syntheticXUserId: authorXUserId,
        untrustedText: text,
        modelEconomicAction,
        proposedAmount: amountLocked,
        economicReason: reasonLocked,
        turns,
        economicInteractionId: interaction.id,
        errorCode: "amount_mutated_during_wallet_flow",
        executeTest,
        dryRun,
        durationMs: Date.now() - started,
      });
    }

    // Authority recheck with confirmed wallet (P1C limits, no clamp).
    const reentryPerceptionId = executeTest
      ? (
          await ensurePerceptionScaffold({
            db: await resolveAdmin(input.admin),
            xPostId: confirmXPostId,
            authorXUserId,
            body: confirmText,
            username: "mvp_rehearsal_confirm",
          })
        )
      : `pe-mvp-confirm-${operationLabel}`;

    const planned = planTransferFromConfirmedInteraction({
      interaction,
      perceptionEventId: reentryPerceptionId,
      purseState,
      executionRail: "p1a_test",
      sufficientBalance: true,
    });

    // Apply optional limits by re-planning (same planner — still no clamp).
    const plannedWithLimits = planEconomicEffects({
      economicIntent: {
        type: "transfer_fenn",
        proposedAmount: amountLocked,
        reason: reasonLocked,
        recipientSource: "trusted_profile_wallet",
      },
      reasonCode: intention.reasonCode,
      perceptionEventId: reentryPerceptionId,
      interactionConfirmedWallet: interaction.confirmedWallet,
      economicInteractionId: interaction.id,
      purseState,
      executionRail: "p1a_test",
      sufficientBalance: true,
      limits: input.limits,
    });

    const effects =
      input.limits != null ? plannedWithLimits.effects : planned.effects;
    const skipped =
      input.limits != null
        ? plannedWithLimits.skippedReason
        : planned.skippedReason;

    if (effects.length === 0) {
      return emptyResult({
        ok: true,
        status: "economic_refused",
        operationLabel,
        syntheticXUserId: authorXUserId,
        untrustedText: text,
        modelEconomicAction,
        proposedAmount: amountLocked,
        economicReason: reasonLocked,
        turns,
        economicInteractionId: interaction.id,
        confirmedWallet: interaction.confirmedWallet,
        authorityOutcome: "blocked",
        authorityRefusalReason: skipped,
        executeTest,
        dryRun,
        durationMs: Date.now() - started,
      });
    }

    const plannedAmount =
      typeof effects[0]?.payload.amountFormatted === "string"
        ? String(effects[0].payload.amountFormatted)
        : amountLocked;

    if (plannedAmount !== amountLocked) {
      return emptyResult({
        ok: false,
        status: "failed",
        operationLabel,
        syntheticXUserId: authorXUserId,
        untrustedText: text,
        modelEconomicAction,
        proposedAmount: amountLocked,
        turns,
        errorCode: "planned_amount_diverged",
        executeTest,
        dryRun,
        durationMs: Date.now() - started,
      });
    }

    // ---- Dry-run: stop before Stage 12.6 / chain ----
    if (!executeTest) {
      turns.push({
        stage: "authority_reentry_preview",
        xPostId: confirmXPostId,
        input: "(authority recheck after wallet confirm)",
        interactionStatus: interaction.status,
        speech: afterConfirm.replyText,
        speechFallbackUsed: afterConfirm.speechFallbackUsed,
        kind: "transfer_planned",
        trustedState: {
          plannedAmount,
          recipientAddress: interaction.confirmedWallet,
          effects: effects.map((e) => ({
            type: e.type,
            idempotencyKey: e.idempotencyKey,
          })),
          stage126Used: false,
          dryRun: true,
        },
      });

      return emptyResult({
        ok: true,
        status: "dry_run_complete",
        operationLabel,
        syntheticXUserId: authorXUserId,
        untrustedText: text,
        modelEconomicAction,
        proposedAmount: amountLocked,
        economicReason: reasonLocked,
        turns,
        economicInteractionId: interaction.id,
        confirmedWallet: interaction.confirmedWallet,
        authorityOutcome: "permitted",
        amountFormatted: plannedAmount,
        isTest: true,
        executeTest: false,
        dryRun: true,
        chainBroadcastAttempted: false,
        durationMs: Date.now() - started,
      });
    }

    // ---- Execute-test: durable effect + Stage 12.6 + disposable purse ----
    const db = await resolveAdmin(input.admin);
    const confirmPerceptionId = reentryPerceptionId;
    const confirmJudgementId = await ensureJudgementScaffold({
      db,
      perceptionEventId: confirmPerceptionId,
      speechAction: "do_nothing",
      reasonCode: intention.reasonCode,
      replyText: afterConfirm.replyText,
      economicIntent: modelEconomicAction,
    });

    // Mark interaction executing before broadcast
    interaction = await updateEconomicInteraction({
      id: interaction.id,
      patch: { status: "executing" },
      admin: db,
    });

    const persistDecision: AuthorityDecision = {
      outcome: "permitted",
      policyCode: "permitted_transfer_p1b",
      policyVersion: STAGE125_POLICY_VERSION,
      finalAction: "do_nothing",
      sourceXPostId: confirmXPostId,
      effects,
      policyOutcome: "blocked",
    };

    const { persistXPerceptionAuthorization } = await import(
      "@/lib/agent/authority-persist"
    );
    await persistXPerceptionAuthorization(
      {
        perceptionEventId: confirmPerceptionId,
        judgementId: confirmJudgementId,
        decision: persistDecision,
      },
      { admin: db as never },
    );

    const { data: effectsRows } = await db
      .from("x_perception_effects")
      .select("id, effect_type, type, status, external_result_id")
      .eq("perception_event_id", confirmPerceptionId);

    const econRow = (effectsRows ?? []).find((e) => {
      const r = e as Record<string, unknown>;
      const t = String(r.effect_type ?? r.type ?? "");
      return t === "transfer_fenn";
    }) as Record<string, unknown> | undefined;

    if (econRow && String(econRow.status) === "completed") {
      const effectId = String(econRow.id);
      const txHash =
        typeof econRow.external_result_id === "string"
          ? econRow.external_result_id
          : null;
      if (txHash) {
        const completion = await completePreviewFromSettlement({
          actionType: "transfer",
          amountFormatted: plannedAmount,
          txHash,
          confirmedAt: new Date().toISOString(),
          isTest: true,
          economicEffectId: effectId,
          sourceXPostId: confirmXPostId,
          recipientAddress: interaction.confirmedWallet,
          forceSpeechFallback,
          callCompletionSpeechModel: input.callCompletionSpeechModel,
        });
        return emptyResult({
          ok: true,
          status: "already_completed",
          operationLabel,
          syntheticXUserId: authorXUserId,
          untrustedText: text,
          modelEconomicAction,
          proposedAmount: amountLocked,
          economicReason: reasonLocked,
          turns,
          economicInteractionId: interaction.id,
          confirmedWallet: interaction.confirmedWallet,
          authorityOutcome: "permitted",
          economicEffectId: effectId,
          purseOperationId: stage12TransferPurseOperationId(effectId),
          settlementStatus: "confirmed",
          amountFormatted: plannedAmount,
          txHash,
          explorerUrl: explorerTxUrl(ROBINHOOD_CHAIN_ID, txHash),
          isTest: true,
          completionSpeech: completion.speech,
          completionSpeechFallbackUsed: completion.fallback,
          completionReplyTarget: completion.replyTarget,
          completionIdempotencyKey: completion.idempotencyKey,
          chainBroadcastAttempted: false,
          executeTest,
          dryRun: false,
          durationMs: Date.now() - started,
        });
      }
    }

    const executeOne =
      input.executeEffect ??
      (await import("@/lib/agent/stage126-execute")).executeOneXPerceptionEffect;

    const one = await executeOne(
      { xPostId: confirmXPostId, dryRun: false },
      { admin: db as never },
    );

    turns.push({
      stage: "stage126_execute",
      xPostId: confirmXPostId,
      input: "(Stage 12.6 claim + Purse disposable rail)",
      interactionStatus: "executing",
      speech: one.economicFollowupPreview ?? null,
      speechFallbackUsed: null,
      kind: one.status,
      trustedState: {
        effectId: one.effectId,
        effectType: one.effectType,
        stage126Used: true,
        purseAdapterPath: "executeTransferFennViaPurse",
      },
    });

    const effectId = one.effectId ?? (econRow?.id ? String(econRow.id) : null);
    const signed =
      one.status === "completed" ||
      one.status === "already_completed_skipped";
    let status: MvpRehearsalResult["status"] = "failed";
    if (one.status === "completed") status = "completed";
    else if (one.status === "already_completed_skipped") {
      status = "already_completed";
    } else if (one.failureClass === "ambiguous") status = "ambiguous";

    let completionSpeech: string | null = one.economicFollowupPreview ?? null;
    let completionFallback: boolean | null = null;
    let completionTarget: string | null = confirmXPostId;
    let completionKey: string | null = effectId
      ? stage12EconomicFollowupReplyIdempotencyKey(effectId)
      : null;

    if (signed && one.externalResultId && effectId) {
      // P1E preview only — never persist live X from this harness.
      const c = await completePreviewFromSettlement({
        actionType: "transfer",
        amountFormatted: plannedAmount,
        txHash: one.externalResultId,
        confirmedAt: new Date().toISOString(),
        isTest: true,
        economicEffectId: effectId,
        sourceXPostId: confirmXPostId,
        recipientAddress: interaction.confirmedWallet,
        forceSpeechFallback,
        callCompletionSpeechModel: input.callCompletionSpeechModel,
      });
      completionSpeech = c.speech;
      completionFallback = c.fallback;
      completionTarget = c.replyTarget;
      completionKey = c.idempotencyKey;

      turns.push({
        stage: "p1e_completion_preview",
        xPostId: confirmXPostId,
        input: "(confirmed settlement → completion speech preview)",
        interactionStatus: "completed",
        speech: completionSpeech,
        speechFallbackUsed: completionFallback,
        kind: "completion_preview",
        trustedState: {
          txHash: one.externalResultId,
          explorerUrl: explorerTxUrl(ROBINHOOD_CHAIN_ID, one.externalResultId),
          liveXPostAttempted: false,
          isTest: true,
        },
      });
    }

    return emptyResult({
      ok:
        status === "completed" ||
        status === "already_completed" ||
        status === "ambiguous",
      status,
      operationLabel,
      syntheticXUserId: authorXUserId,
      untrustedText: text,
      modelEconomicAction,
      proposedAmount: amountLocked,
      economicReason: reasonLocked,
      turns,
      economicInteractionId: interaction.id,
      confirmedWallet: interaction.confirmedWallet,
      authorityOutcome: "permitted",
      authorityRefusalReason: null,
      economicEffectId: effectId,
      purseOperationId: effectId
        ? stage12TransferPurseOperationId(effectId)
        : null,
      settlementStatus: signed ? "confirmed" : one.failureClass ?? one.status,
      amountFormatted: plannedAmount,
      txHash: one.externalResultId ?? null,
      explorerUrl: one.externalResultId
        ? explorerTxUrl(ROBINHOOD_CHAIN_ID, one.externalResultId)
        : null,
      isTest: true,
      completionSpeech,
      completionSpeechFallbackUsed: completionFallback,
      completionReplyTarget: completionTarget,
      completionIdempotencyKey: completionKey,
      chainBroadcastAttempted: signed || one.status === "failed",
      executeTest: true,
      dryRun: false,
      errorCode: one.errorCode ?? null,
      durationMs: Date.now() - started,
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

    return emptyResult({
      ok: false,
      status: "scaffold_failed",
      operationLabel,
      syntheticXUserId: authorXUserId,
      untrustedText: text,
      turns,
      executeTest,
      dryRun,
      errorCode:
        error instanceof Error
          ? error.message.slice(0, 180)
          : "mvp_rehearsal_failed",
      providerFailure,
      durationMs: Date.now() - started,
    });
  }
}
