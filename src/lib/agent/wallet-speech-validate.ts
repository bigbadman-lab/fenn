/**
 * Stage P1D.1 — post-generation transactional fact validation for wallet speech.
 */

import { replyClaimsCompletedEconomicAction } from "@/lib/agent/economic-followup";
import {
  walletSpeechMomentRequiresAmount,
  walletSpeechMomentRequiresShortWallet,
  type WalletSpeechFacts,
} from "@/lib/agent/wallet-speech-facts";

export type WalletSpeechValidation = {
  ok: boolean;
  reasons: string[];
};

/**
 * Whether prose presents the locked amount as a number token.
 * Accepts the frozen decimal string and common thousand-separator forms of the
 * *same* digits (e.g. 10000 ↔ 10,000). Does not accept a different magnitude.
 */
export function textPresentsLockedAmount(
  text: string,
  lockedAmount: string,
): boolean {
  const locked = lockedAmount.replace(/,/g, "").trim().replace(/\.0+$/, "");
  if (!locked) return false;
  const nums =
    text.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/g) ?? [];
  for (const n of nums) {
    const norm = n.replace(/,/g, "").replace(/\.0+$/, "");
    if (norm === locked) return true;
  }
  return false;
}

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
    if (amount && extractForeignAmount(t, amount)) {
      reasons.push("foreign_amount");
    }
  }

  // Never invent a different amount when a locked amount exists.
  if (amount && extractForeignAmount(t, amount)) {
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

/** Detect another positive integer-like amount token that is not the locked amount. */
function extractForeignAmount(text: string, locked: string): boolean {
  const lockedNorm = locked.replace(/,/g, "").trim().replace(/\.0+$/, "");
  const nums =
    text.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/g) ?? [];
  for (const n of nums) {
    const norm = n.replace(/,/g, "").replace(/\.0+$/, "");
    if (norm === lockedNorm) continue;
    // Allow tiny counts in prose (1, 2) unless they equal multi-digit locked
    if (norm.length <= 2 && lockedNorm.length > 2) continue;
    if (norm !== lockedNorm && Number(norm) > 0) {
      if (norm.length >= 3 || Number(norm) >= 100) {
        return true;
      }
    }
  }
  return false;
}
