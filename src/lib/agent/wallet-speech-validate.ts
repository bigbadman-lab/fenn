/**
 * Stage P1D.1 — post-generation transactional fact validation for wallet speech.
 */

import { replyClaimsCompletedEconomicAction } from "@/lib/agent/economic-followup";
import {
  textHasForeignSpeechAmount,
  textPresentsLockedAmount,
} from "@/lib/agent/speech-amount-match";
import {
  walletSpeechMomentRequiresAmount,
  walletSpeechMomentRequiresShortWallet,
  type WalletSpeechFacts,
} from "@/lib/agent/wallet-speech-facts";

export type WalletSpeechValidation = {
  ok: boolean;
  reasons: string[];
};

// Re-export for callers that already import from this module.
export { textPresentsLockedAmount } from "@/lib/agent/speech-amount-match";

/**
 * Deterministic checks after model expression.
 * Prefer regeneration/fallback over accepting unsafe prose.
 */
export function validateWalletSpeechAgainstFacts(
  text: string,
  facts: WalletSpeechFacts,
): WalletSpeechValidation {
  const reasons: string[] = [];
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) {
    return { ok: false, reasons: ["empty"] };
  }

  const amount = facts.amountFormatted?.trim();
  const short = facts.shortWallet?.trim();

  // Completion claims forbidden unless we later add a confirmed-settlement moment.
  if (
    facts.settlementState === "not_sent" ||
    facts.settlementState === "pending" ||
    facts.settlementState === "refused"
  ) {
    if (replyClaimsCompletedEconomicAction(t)) {
      reasons.push("completion_claim");
    }
    // Extra patterns: "it is yours", bare "done.", "sent successfully"
    if (
      /\bit is yours\b/i.test(t) ||
      /\bsent successfully\b/i.test(t) ||
      /\btransfer complete\b/i.test(t) ||
      /(^|\b)done\.?(\b|$)/i.test(t)
    ) {
      reasons.push("completionish_claim");
    }
  }

  // Amount required by moment + fact present → prose must present that amount.
  if (walletSpeechMomentRequiresAmount(facts.moment) && amount) {
    if (!textPresentsLockedAmount(t, amount)) {
      reasons.push("missing_amount");
    }
  }

  if (walletSpeechMomentRequiresShortWallet(facts.moment) && short) {
    if (!t.includes(short)) {
      reasons.push("missing_short_wallet");
    }
  }

  if (facts.moment === "economic_refused") {
    // Must not invent / promise payment.
    if (/\bi will send\b|\bi'll send\b|\bwill send you\b/i.test(t)) {
      reasons.push("promise_payment");
    }
    if (amount && textHasForeignSpeechAmount(t, amount)) {
      reasons.push("foreign_amount");
    }
  }

  // Never invent a different amount when a locked amount exists.
  if (amount && textHasForeignSpeechAmount(t, amount)) {
    reasons.push("foreign_amount");
  }

  // Full different 0x addresses must not appear when shortWallet is locked.
  if (short) {
    const addrs = t.match(/0x[a-fA-F0-9]{40}/g) ?? [];
    for (const a of addrs) {
      const norm = a.toLowerCase();
      const prefix = short.slice(0, 6).toLowerCase();
      const suffix = short.slice(-4).toLowerCase();
      if (!(norm.startsWith(prefix) && norm.endsWith(suffix))) {
        reasons.push("foreign_wallet");
        break;
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}
