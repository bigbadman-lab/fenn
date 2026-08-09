/**
 * Stage P1D.1 — trusted wallet-collection speech facts.
 *
 * APPLICATION OWNS TRUTH. These facts are deterministic inputs to
 * Book of Speech expression. The model must not alter them.
 *
 * Amount-bearing moments must always receive the frozen interaction / model
 * proposed amount (never user text).
 */

import {
  isNormalizedEvmAddress,
  normalizeEvmAddress,
} from "@/lib/wallet/evm";

/** Deterministic short form for speech facts (matches wallet-collection convention). */
export function shortWalletForSpeech(walletAddress: string): string {
  const n = normalizeEvmAddress(walletAddress);
  if (!isNormalizedEvmAddress(n)) return walletAddress;
  return `${n.slice(0, 6)}…${n.slice(-4)}`;
}

export const WALLET_SPEECH_MOMENTS = [
  "destination_required",
  "destination_confirmation",
  "destination_invalid",
  "destination_rejected",
  "destination_confirmed_pending",
  "destination_expired",
  "economic_refused",
] as const;

export type WalletSpeechMoment = (typeof WALLET_SPEECH_MOMENTS)[number];

/** Moments for which amountFormatted must be present in facts (producer law). */
export function walletSpeechMomentRequiresAmount(
  moment: WalletSpeechMoment,
): boolean {
  return (
    moment === "destination_required" ||
    moment === "destination_confirmed_pending"
  );
}

/** Moments that require shortWallet fact. */
export function walletSpeechMomentRequiresShortWallet(
  moment: WalletSpeechMoment,
): boolean {
  return (
    moment === "destination_confirmation" ||
    moment === "destination_confirmed_pending"
  );
}

export const WALLET_SPEECH_SETTLEMENT_STATES = [
  "not_sent",
  "pending",
  "refused",
] as const;

export type WalletSpeechSettlementState =
  (typeof WALLET_SPEECH_SETTLEMENT_STATES)[number];

/** Safe categories only — no secrets / internal stack traces. */
export const WALLET_SPEECH_REFUSAL_CATEGORIES = [
  "purse_limit",
  "insufficient_balance",
  "purse_unavailable",
  "interaction_expired",
  "execution_not_permitted",
] as const;

export type WalletSpeechRefusalCategory =
  (typeof WALLET_SPEECH_REFUSAL_CATEGORIES)[number];

export type WalletSpeechFacts = {
  moment: WalletSpeechMoment;
  /** Frozen FENN amount when relevant (decimal string). */
  amountFormatted?: string;
  /** Deterministic shortened 0x form when relevant. */
  shortWallet?: string;
  settlementState: WalletSpeechSettlementState;
  refusalReason?: WalletSpeechRefusalCategory;
};

function freezeAmount(amountFormatted: string): string {
  return amountFormatted.trim();
}

export function speechFactsDestinationRequired(
  amountFormatted: string,
): WalletSpeechFacts {
  return {
    moment: "destination_required",
    amountFormatted: freezeAmount(amountFormatted),
    settlementState: "not_sent",
  };
}

export function speechFactsDestinationConfirmation(
  candidateWallet: string,
): WalletSpeechFacts {
  return {
    moment: "destination_confirmation",
    shortWallet: shortWalletForSpeech(candidateWallet),
    settlementState: "not_sent",
  };
}

export function speechFactsDestinationInvalid(): WalletSpeechFacts {
  return {
    moment: "destination_invalid",
    settlementState: "not_sent",
  };
}

export function speechFactsDestinationRejected(): WalletSpeechFacts {
  return {
    moment: "destination_rejected",
    settlementState: "not_sent",
  };
}

export function speechFactsDestinationConfirmedPending(input: {
  proposedAmount: string;
  confirmedWallet: string;
}): WalletSpeechFacts {
  return {
    moment: "destination_confirmed_pending",
    amountFormatted: freezeAmount(input.proposedAmount),
    shortWallet: shortWalletForSpeech(input.confirmedWallet),
    settlementState: "pending",
  };
}

export function speechFactsDestinationExpired(): WalletSpeechFacts {
  return {
    moment: "destination_expired",
    settlementState: "not_sent",
  };
}

export function speechFactsEconomicRefused(input: {
  proposedAmount?: string;
  shortWallet?: string;
  refusalReason: WalletSpeechRefusalCategory;
}): WalletSpeechFacts {
  return {
    moment: "economic_refused",
    amountFormatted: input.proposedAmount?.trim() || undefined,
    shortWallet: input.shortWallet,
    settlementState: "refused",
    refusalReason: input.refusalReason,
  };
}

/**
 * Map authority skipped / refuse reasons into safe speech categories.
 */
export function mapAuthoritySkippedToRefusalCategory(
  skippedReason: string | null | undefined,
): WalletSpeechRefusalCategory {
  const r = (skippedReason ?? "").trim().toLowerCase();
  if (!r) return "execution_not_permitted";
  if (r.includes("balance") || r.includes("insufficient")) {
    return "insufficient_balance";
  }
  if (
    r.includes("limit") ||
    r.includes("exceeds") ||
    r.includes("rolling") ||
    r.includes("max_single")
  ) {
    return "purse_limit";
  }
  if (
    r.includes("purse") &&
    (r.includes("unavailable") ||
      r.includes("disabled") ||
      r.includes("not_enabled") ||
      r.includes("unconfigured"))
  ) {
    return "purse_unavailable";
  }
  if (r.includes("expired")) return "interaction_expired";
  if (
    r.includes("unavailable") ||
    r.includes("unconfigured") ||
    r.includes("official_fenn")
  ) {
    return "purse_unavailable";
  }
  return "execution_not_permitted";
}

/**
 * Deterministic safe fallback copy — used only when the Book of Speech writer fails.
 * Correctness outranks voice.
 */
export function buildWalletSpeechFallback(facts: WalletSpeechFacts): string {
  const amount = facts.amountFormatted?.trim() ?? "";
  const short = facts.shortWallet?.trim() ?? "";

  switch (facts.moment) {
    case "destination_required":
      return `I intend to send ${amount} FENN. Reply with the destination wallet address (0x…). Settlement is not done yet.`.slice(
        0,
        280,
      );
    case "destination_confirmation":
      return `Use ${short}? Reply yes to confirm, or send a different 0x address. Nothing has been sent.`.slice(
        0,
        280,
      );
    case "destination_invalid":
      return "I still need a single valid destination wallet (0x…). Nothing has been sent.".slice(
        0,
        280,
      );
    case "destination_rejected":
      return "Understood — send a different destination wallet when you have one. Nothing has been sent.".slice(
        0,
        280,
      );
    case "destination_confirmed_pending":
      return `Confirmed ${short}. I will send ${amount} FENN there if the Purse still allows it. Settlement is not complete until the chain confirms.`.slice(
        0,
        280,
      );
    case "destination_expired":
      return "That pending transfer lapsed before a destination was confirmed. Nothing was sent.".slice(
        0,
        280,
      );
    case "economic_refused":
      return (
        amount
          ? `I could not complete the transfer of ${amount} FENN. Nothing has been sent.`
          : "I could not complete that transfer. Nothing has been sent."
      ).slice(0, 280);
    default: {
      const _exhaustive: never = facts.moment;
      return _exhaustive;
    }
  }
}

/** Compact fact block for model user payloads and quality recovery. */
export function formatWalletSpeechFactsBlock(facts: WalletSpeechFacts): string {
  const lines = [
    "TRUSTED WALLET SPEECH FACTS (application-owned; do not alter):",
    `moment: ${facts.moment}`,
    `settlementState: ${facts.settlementState}`,
  ];
  if (facts.amountFormatted) {
    lines.push(`amountFormatted: ${facts.amountFormatted}`);
  }
  if (facts.shortWallet) {
    lines.push(`shortWallet: ${facts.shortWallet}`);
  }
  if (facts.refusalReason) {
    lines.push(`refusalReason: ${facts.refusalReason}`);
  }

  const required: string[] = [];
  if (
    walletSpeechMomentRequiresAmount(facts.moment) &&
    facts.amountFormatted?.trim()
  ) {
    required.push(
      `amountFormatted exact digits (no paraphrase): ${facts.amountFormatted.trim()}`,
    );
  }
  if (
    walletSpeechMomentRequiresShortWallet(facts.moment) &&
    facts.shortWallet?.trim()
  ) {
    required.push(`shortWallet exact: ${facts.shortWallet.trim()}`);
  }
  if (required.length > 0) {
    lines.push("REQUIRED_INCLUSIONS (must appear in replyText):");
    for (const r of required) lines.push(`- ${r}`);
  }

  lines.push(
    "transactionBroadcast: false",
    "transactionConfirmed: false",
    "transactionHash: none",
  );
  return lines.join("\n");
}
