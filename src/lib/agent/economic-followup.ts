/**
 * Stage P1E — post-confirmation economic completion speech (facts + fallback + validation).
 *
 * APPLICATION OWNS TRUTH. BOOK OF SPEECH OWNS EXPRESSION.
 * Never invent amounts, recipients, hashes, or settlement status.
 */

import { explorerTxUrl } from "@/lib/greenwood/hollow/explorer";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { STAGE12_X_REPLY_MAX_CHARS } from "@/lib/agent/judge-config";
import {
  isNormalizedEvmAddress,
  normalizeEvmAddress,
} from "@/lib/wallet/evm";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";

export type EconomicCompletionActionType = "transfer" | "burn";

/**
 * Trusted post-confirmation facts for speech. Never from the model.
 */
export type EconomicCompletionFacts = {
  actionType: EconomicCompletionActionType;
  /** Exact confirmed amount (decimal string). */
  amountFormatted: string;
  /** Transfer recipient (normalized). Burn uses dead address. */
  recipientAddress: string;
  /** Shortened 0x form for transfer (display). */
  shortRecipient?: string;
  txHash: string;
  explorerUrl: string;
  confirmedAt: string;
  isTest: boolean;
  /** Stage 12 economic effect that settled. */
  economicEffectId: string;
  /** X post snowflake to reply to. */
  replyToXPostId: string;
};

/** @deprecated alias — prefer EconomicCompletionFacts */
export type EconomicFollowupFacts = {
  actionType: "transfer" | "burn";
  amountFormatted: string;
  txHash: string;
  chainId?: number;
  recipientAddress?: string | null;
};

export type EconomicFollowupDraft = {
  text: string;
  explorerUrl: string | null;
  facts: EconomicFollowupFacts;
};

export function shortRecipientForSpeech(address: string): string {
  const n = normalizeEvmAddress(address);
  if (!isNormalizedEvmAddress(n)) return address;
  return `${n.slice(0, 6)}…${n.slice(-4)}`;
}

/**
 * Settlement statuses that must NEVER produce success speech.
 * Only confirmed is eligible.
 */
export function settlementAllowsCompletionSpeech(
  status: string | null | undefined,
): boolean {
  return (status ?? "").trim().toLowerCase() === "confirmed";
}

/**
 * Build trusted completion facts after Purse confirms.
 * Returns null if explorer URL cannot be derived (fail closed).
 */
export function buildEconomicCompletionFacts(input: {
  actionType: EconomicCompletionActionType;
  amountFormatted: string;
  txHash: string;
  confirmedAt: string;
  isTest: boolean;
  economicEffectId: string;
  replyToXPostId: string;
  recipientAddress?: string | null;
  chainId?: number;
}): EconomicCompletionFacts | null {
  const amount = input.amountFormatted.trim();
  const txHash = input.txHash.trim();
  const replyTo = input.replyToXPostId.trim();
  const economicEffectId = input.economicEffectId.trim();
  if (!amount || !txHash || !replyTo || !economicEffectId) return null;

  const chainId = input.chainId ?? ROBINHOOD_CHAIN_ID;
  const explorerUrl = explorerTxUrl(chainId, txHash);
  if (!explorerUrl) return null;

  let recipientAddress: string;
  if (input.actionType === "burn") {
    recipientAddress = normalizeEvmAddress(FENN_DEAD_ADDRESS);
  } else {
    const raw = (input.recipientAddress ?? "").trim();
    if (!raw) return null;
    try {
      recipientAddress = normalizeEvmAddress(raw);
    } catch {
      return null;
    }
    if (!isNormalizedEvmAddress(recipientAddress)) return null;
  }

  return {
    actionType: input.actionType,
    amountFormatted: amount,
    recipientAddress,
    shortRecipient:
      input.actionType === "transfer"
        ? shortRecipientForSpeech(recipientAddress)
        : undefined,
    txHash,
    explorerUrl,
    confirmedAt: input.confirmedAt.trim() || new Date().toISOString(),
    isTest: Boolean(input.isTest),
    economicEffectId,
    replyToXPostId: replyTo,
  };
}

/**
 * Deterministic safe fallback — used when Book of Speech generation fails.
 */
export function buildEconomicCompletionFallback(
  facts: EconomicCompletionFacts,
): string {
  const amount = facts.amountFormatted;
  const explorer = facts.explorerUrl;
  if (facts.actionType === "burn") {
    return `${amount} FENN will not return. The chain keeps the proof: ${explorer}`.slice(
      0,
      STAGE12_X_REPLY_MAX_CHARS,
    );
  }
  const short = facts.shortRecipient ?? shortRecipientForSpeech(facts.recipientAddress);
  return `${amount} FENN left the Purse for ${short}. The chain keeps the receipt: ${explorer}`.slice(
    0,
    STAGE12_X_REPLY_MAX_CHARS,
  );
}

/**
 * Legacy hard draft used as fallback identity for buildEconomicFollowupDraft.
 */
export function buildEconomicFollowupDraft(
  facts: EconomicFollowupFacts,
): EconomicFollowupDraft {
  const chainId = facts.chainId ?? ROBINHOOD_CHAIN_ID;
  const explorerUrl = explorerTxUrl(chainId, facts.txHash);
  const amount = facts.amountFormatted.trim();
  const shortHash =
    facts.txHash.length > 14
      ? `${facts.txHash.slice(0, 10)}…`
      : facts.txHash.trim();

  // Preserve legacy predicate shape used by P1B/P1C tests while routing
  // production paths through EconomicCompletionFacts + Book of Speech.
  let text: string;
  if (facts.actionType === "burn") {
    text = `${amount} FENN left my Purse for the dead address. It will not return. ${shortHash}`;
  } else {
    text = `${amount} FENN left my Purse. ${shortHash}`;
  }
  if (explorerUrl) {
    text = `${text} ${explorerUrl}`.slice(0, STAGE12_X_REPLY_MAX_CHARS);
  }

  return {
    text: text.slice(0, STAGE12_X_REPLY_MAX_CHARS),
    explorerUrl,
    facts,
  };
}

/**
 * Idempotency key for a post-confirmation economic follow-up reply effect.
 * Exactly one reply effect per economic effect.
 */
export function stage12EconomicFollowupReplyIdempotencyKey(
  economicEffectId: string,
): string {
  const id = economicEffectId.trim();
  if (!id) throw new Error("economicEffectId must be non-empty");
  return `stage12:economic_followup:${id}`;
}

/**
 * Guard language for pre-confirmation drafts (used by tests).
 */
export function replyClaimsCompletedEconomicAction(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /i (have|just) (sent|transferred|burned)/.test(t) ||
    /transfer (is|was) complete/.test(t) ||
    /burn (is|was) complete/.test(t) ||
    /tx confirmed/.test(t)
  );
}

export type CompletionSpeechValidation = {
  ok: boolean;
  reasons: string[];
};

/**
 * Post-model fact lock for completion speech.
 */
export function validateEconomicCompletionSpeech(
  text: string,
  facts: EconomicCompletionFacts,
): CompletionSpeechValidation {
  const reasons: string[] = [];
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return { ok: false, reasons: ["empty"] };
  if (t.length > STAGE12_X_REPLY_MAX_CHARS) {
    reasons.push("too_long");
  }
  if (!t.includes(facts.amountFormatted)) {
    reasons.push("missing_amount");
  }
  if (!t.includes(facts.explorerUrl) && !t.includes(facts.txHash)) {
    reasons.push("missing_proof");
  }

  if (facts.actionType === "transfer") {
    if (/\bburn(ed|ing)?\b/i.test(t) && !/\btransfer\b/i.test(t)) {
      // burn language without transfer context on a transfer action
      if (/\bdead address\b|\bwill not return\b/i.test(t)) {
        reasons.push("burn_language_on_transfer");
      }
    }
    if (facts.shortRecipient && !t.includes(facts.shortRecipient)) {
      // allow full address
      if (!t.toLowerCase().includes(facts.recipientAddress.toLowerCase())) {
        reasons.push("missing_recipient");
      }
    }
  }

  if (facts.actionType === "burn") {
    if (/\btotal\s*supply\b/i.test(t) || /\bdestroyed supply\b/i.test(t)) {
      reasons.push("totalsupply_claim");
    }
    if (
      /\b(gift|reward|prize)\b/i.test(t) &&
      /\bsent (you|them)\b/i.test(t)
    ) {
      reasons.push("reward_language");
    }
  }

  // Foreign amounts (multi-digit tokens not equal to locked amount)
  const locked = facts.amountFormatted.replace(/,/g, "");
  const nums = t.match(/\b\d{1,3}(?:,\d{3})+\b|\b\d{4,}\b/g) ?? [];
  for (const n of nums) {
    const norm = n.replace(/,/g, "");
    if (norm !== locked && Number(norm) >= 100) {
      reasons.push("foreign_amount");
      break;
    }
  }

  // Foreign 64-byte hashes
  const hashes = t.match(/0x[a-fA-F0-9]{64}/g) ?? [];
  for (const h of hashes) {
    if (h.toLowerCase() !== facts.txHash.toLowerCase()) {
      reasons.push("foreign_hash");
      break;
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/** Format trusted facts for model user payloads. */
export function formatEconomicCompletionFactsBlock(
  facts: EconomicCompletionFacts,
): string {
  const lines = [
    "TRUSTED ECONOMIC COMPLETION FACTS (application-owned; do not alter):",
    `actionType: ${facts.actionType}`,
    `amountFormatted: ${facts.amountFormatted}`,
    `recipientAddress: ${facts.recipientAddress}`,
    facts.shortRecipient ? `shortRecipient: ${facts.shortRecipient}` : null,
    `txHash: ${facts.txHash}`,
    `explorerUrl: ${facts.explorerUrl}`,
    `confirmedAt: ${facts.confirmedAt}`,
    `settlementStatus: confirmed`,
    `isTest: ${facts.isTest}`,
    "privateKey: never present",
  ].filter(Boolean) as string[];
  return lines.join("\n");
}

/**
 * Whether P1E may persist a live reply_on_x for a test (disposable) settlement.
 * Default: false — automated tests must not post to @askfenn.
 */
export function allowTestEconomicFollowupX(): boolean {
  return process.env.FENN_P1E_ALLOW_TEST_FOLLOWUP_X === "explicit_allow";
}
