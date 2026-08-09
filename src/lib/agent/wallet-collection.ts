/**
 * Stage P1D — candidate wallet extraction + confirmation parsing.
 *
 * X text may supply a CANDIDATE address only when FENN explicitly asked
 * (awaiting_wallet). Candidate ≠ spend trust until confirmed on the same turn
 * of the same immutable X user for the same interaction.
 */

import {
  isNormalizedEvmAddress,
  normalizeEvmAddress,
  parseEvmAddress,
} from "@/lib/wallet/evm";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Loose EVM address token discovery (case-insensitive 0x + 40 hex). */
const ADDRESS_TOKEN_RE = /0x[a-fA-F0-9]{40}/g;

export type CandidateWalletExtract =
  | { ok: true; walletAddress: string }
  | {
      ok: false;
      reason:
        | "no_address"
        | "malformed"
        | "zero_address"
        | "multiple_conflicting"
        | "invalid";
    };

/**
 * Extract a single valid EVM address from user text for wallet collection.
 * Does NOT mark the address trusted for spend.
 */
export function extractCandidateWalletFromText(
  body: string,
): CandidateWalletExtract {
  const text = typeof body === "string" ? body : "";
  const matches = text.match(ADDRESS_TOKEN_RE);
  if (!matches || matches.length === 0) {
    return { ok: false, reason: "no_address" };
  }

  const normalizedUnique = new Set<string>();
  for (const m of matches) {
    const n = normalizeEvmAddress(m);
    if (!isNormalizedEvmAddress(n)) {
      return { ok: false, reason: "malformed" };
    }
    normalizedUnique.add(n);
  }

  if (normalizedUnique.size > 1) {
    return { ok: false, reason: "multiple_conflicting" };
  }

  const only = [...normalizedUnique][0]!;
  if (only === ZERO_ADDRESS) {
    return { ok: false, reason: "zero_address" };
  }

  try {
    return { ok: true, walletAddress: parseEvmAddress(only) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/**
 * Deterministic affirmative confirmation for MVP.
 * Only meaningful when an interaction is already awaiting_wallet_confirmation.
 */
export function isAffirmativeWalletConfirmation(body: string): boolean {
  const t = body
    .trim()
    .toLowerCase()
    .replace(/[!?.,]+$/g, "")
    .trim();
  if (!t) return false;

  // Single-word / short affirmatives.
  const exact = new Set([
    "yes",
    "y",
    "yeah",
    "yep",
    "yup",
    "correct",
    "confirmed",
    "confirm",
    "ok",
    "okay",
    "sure",
    "use it",
    "that's right",
    "thats right",
    "that is right",
    "sounds right",
    "do it",
    "go ahead",
    "send it",
  ]);
  if (exact.has(t)) return true;

  // Allow short phrases that clearly affirm the candidate without nominating amounts.
  if (/^(yes|yep|yeah|yup)[, ]+(please|go ahead|send it|use it|correct|confirmed)\.?$/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Explicit rejection of the candidate without a replacement address.
 */
export function isNegativeWalletConfirmation(body: string): boolean {
  const t = body
    .trim()
    .toLowerCase()
    .replace(/[!?.,]+$/g, "")
    .trim();
  if (!t) return false;
  const exact = new Set([
    "no",
    "n",
    "nope",
    "wrong",
    "incorrect",
    "not that",
    "cancel",
    "stop",
    "don't",
    "do not",
  ]);
  if (exact.has(t)) return true;
  if (/^(no|nope|wrong)\b/.test(t) && !ADDRESS_TOKEN_RE.test(body)) {
    return true;
  }
  return false;
}

/**
 * Shortened display form for confirmation speech (repo convention).
 */
export function shortWalletForConfirmation(walletAddress: string): string {
  const n = normalizeEvmAddress(walletAddress);
  if (!isNormalizedEvmAddress(n)) return walletAddress;
  return `${n.slice(0, 6)}…${n.slice(-4)}`;
}

/** Reply templates — deterministic; Book of Speech can wrap later. */
export function buildAskForWalletReply(input: {
  proposedAmount: string;
}): string {
  const amount = input.proposedAmount.trim();
  return `I intend to send ${amount} FENN. Reply with the destination wallet address (0x…). Settlement is not done yet.`.slice(
    0,
    280,
  );
}

export function buildAskWalletConfirmationReply(input: {
  candidateWallet: string;
}): string {
  const short = shortWalletForConfirmation(input.candidateWallet);
  return `Use ${short}? Reply yes to confirm, or send a different 0x address. Nothing has been sent.`.slice(
    0,
    280,
  );
}

export function buildWalletAskAgainReply(): string {
  return "I still need a single valid destination wallet (0x…). Nothing has been sent.".slice(
    0,
    280,
  );
}

export function buildWalletRejectedReply(): string {
  return "Understood — send a different destination wallet when you have one. Nothing has been sent.".slice(
    0,
    280,
  );
}

export function buildWalletConfirmedProceedingReply(input: {
  proposedAmount: string;
  confirmedWallet: string;
}): string {
  const short = shortWalletForConfirmation(input.confirmedWallet);
  return `Confirmed ${short}. I will send ${input.proposedAmount.trim()} FENN there if the Purse still allows it. Settlement is not complete until the chain confirms.`.slice(
    0,
    280,
  );
}
