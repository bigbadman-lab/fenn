/**
 * Stage P1E controlled dry-run harness — confirmed transfer + burn completion speech/plan.
 * No real X posts. No new blockchain transactions.
 */

import "server-only";

import {
  buildEconomicCompletionFacts,
  stage12EconomicFollowupReplyIdempotencyKey,
  type EconomicCompletionFacts,
} from "@/lib/agent/economic-followup";
import { planEconomicCompletionFollowup } from "@/lib/agent/economic-completion-plan";
import type { EconomicCompletionSpeechModelCaller } from "@/lib/agent/economic-completion-speech";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";
import { createHash } from "node:crypto";

function syntheticTx(label: string): string {
  const dig = createHash("sha256").update(`p1e-tx:${label}`).digest("hex");
  return `0x${dig}`;
}

export type P1eHarnessResult = {
  ok: boolean;
  dryRun: true;
  label: string;
  transfer: {
    facts: EconomicCompletionFacts | null;
    replyText: string | null;
    speechSource: string | null;
    idempotencyKey: string;
    replyToXPostId: string;
    explorerUrl: string | null;
    effectSkippedReason: string | null;
  } | null;
  burn: {
    facts: EconomicCompletionFacts | null;
    replyText: string | null;
    speechSource: string | null;
    idempotencyKey: string;
    replyToXPostId: string;
    explorerUrl: string | null;
    effectSkippedReason: string | null;
  } | null;
  error?: string;
};

/**
 * Preview confirmation speech + effect plan for fake confirmed settlements.
 */
export async function runP1eEconomicCompletionHarness(input: {
  label: string;
  transferAmount?: string;
  burnAmount?: string;
  recipientAddress?: string;
  sourceXPostId?: string;
  forceSpeechFallback?: boolean;
  callSpeechModel?: EconomicCompletionSpeechModelCaller;
}): Promise<P1eHarnessResult> {
  const label = input.label.trim() || "p1e";
  const sourceXPostId = (input.sourceXPostId ?? "9103000000000000001").trim();
  const recipient =
    input.recipientAddress ?? "0x92a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab174";
  const transferAmount = input.transferAmount ?? "25000";
  const burnAmount = input.burnAmount ?? "50000";
  const nowIso = new Date().toISOString();

  try {
    const transferEffectId = `p1e-transfer-${label}`;
    const burnEffectId = `p1e-burn-${label}`;
    const txT = syntheticTx(`${label}-t`);
    const txB = syntheticTx(`${label}-b`);

    const transferPlan = await planEconomicCompletionFollowup({
      actionType: "transfer",
      amountFormatted: transferAmount,
      txHash: txT,
      confirmedAt: nowIso,
      isTest: true,
      economicEffectId: transferEffectId,
      sourceXPostId,
      authorizationId: "00000000-0000-0000-0000-000000000001",
      perceptionEventId: "00000000-0000-0000-0000-000000000002",
      recipientAddress: recipient,
      dryRun: true,
      forceSpeechFallback: input.forceSpeechFallback ?? true,
      callSpeechModel: input.callSpeechModel,
    });

    const burnPlan = await planEconomicCompletionFollowup({
      actionType: "burn",
      amountFormatted: burnAmount,
      txHash: txB,
      confirmedAt: nowIso,
      isTest: true,
      economicEffectId: burnEffectId,
      sourceXPostId,
      authorizationId: "00000000-0000-0000-0000-000000000001",
      perceptionEventId: "00000000-0000-0000-0000-000000000002",
      recipientAddress: FENN_DEAD_ADDRESS,
      dryRun: true,
      forceSpeechFallback: input.forceSpeechFallback ?? true,
      callSpeechModel: input.callSpeechModel,
    });

    // Pure fact build for ordering tests without speech
    void buildEconomicCompletionFacts;

    return {
      ok: true,
      dryRun: true,
      label,
      transfer: {
        facts: transferPlan.facts,
        replyText: transferPlan.speech?.replyText ?? null,
        speechSource: transferPlan.speech?.source ?? null,
        idempotencyKey:
          transferPlan.idempotencyKey ??
          stage12EconomicFollowupReplyIdempotencyKey(transferEffectId),
        replyToXPostId: sourceXPostId,
        explorerUrl: transferPlan.facts?.explorerUrl ?? null,
        effectSkippedReason: transferPlan.skippedReason,
      },
      burn: {
        facts: burnPlan.facts,
        replyText: burnPlan.speech?.replyText ?? null,
        speechSource: burnPlan.speech?.source ?? null,
        idempotencyKey:
          burnPlan.idempotencyKey ??
          stage12EconomicFollowupReplyIdempotencyKey(burnEffectId),
        replyToXPostId: sourceXPostId,
        explorerUrl: burnPlan.facts?.explorerUrl ?? null,
        effectSkippedReason: burnPlan.skippedReason,
      },
    };
  } catch (error) {
    return {
      ok: false,
      dryRun: true,
      label,
      transfer: null,
      burn: null,
      error: error instanceof Error ? error.message : "p1e_harness_failed",
    };
  }
}
