/**
 * Stage P1D.1 — post-generation transactional fact validation for wallet speech.
 */

import { replyClaimsCompletedEconomicAction } from "@/lib/agent/economic-followup";
import type { WalletSpeechFacts } from "@/lib/agent/wallet-speech-facts";

export type WalletSpeechValidation = {
  ok: boolean;
  reasons: string[];
};

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

  if (facts.moment === "destination_required" && amount) {
    if (!t.includes(amount)) {
      reasons.push("missing_amount");
    }
  }

  if (facts.moment === "destination_confirmation" && short) {
    if (!t.includes(short)) {
      reasons.push("missing_short_wallet");
    }
  }

  if (facts.moment === "destination_confirmed_pending") {
    if (amount && !t.includes(amount)) {
      reasons.push("missing_amount");
    }
    if (short && !t.includes(short)) {
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
      // short form is first6…last4 of normalized — full address may include hex without matching short
      const norm = a.toLowerCase();
      const shortCore = short.replace("…", "").toLowerCase();
      // Allow full address only if it starts/ends matching short form prefix/suffix
      const prefix = short.slice(0, 6).toLowerCase();
      const suffix = short.slice(-4).toLowerCase();
      if (!(norm.startsWith(prefix) && norm.endsWith(suffix))) {
        reasons.push("foreign_wallet");
        break;
      }
      void shortCore;
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/** Detect another positive integer-like amount token that is not the locked amount. */
function extractForeignAmount(text: string, locked: string): boolean {
  const lockedNorm = locked.replace(/,/g, "").trim();
  // Match numbers that look like token amounts (not hex tails).
  const nums = text.match(/\b\d{1,3}(?:,\d{3})+\b|\b\d{4,}\b|\b\d+\b/g) ?? [];
  for (const n of nums) {
    const norm = n.replace(/,/g, "");
    if (norm === lockedNorm) continue;
    // Allow tiny counts in prose (1, 2) unless they equal multi-digit locked
    if (norm.length <= 2 && lockedNorm.length > 2) continue;
    // Ignore 0x hex length fragments mis-detected — already handled by \b
    if (norm !== lockedNorm && Number(norm) > 0) {
      // If locked is 25000, reject 100000 appearing
      if (norm.length >= 3 || Number(norm) >= 100) {
        return true;
      }
    }
  }
  return false;
}
