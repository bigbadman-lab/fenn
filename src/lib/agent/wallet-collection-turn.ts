/**
 * Stage P1D — pure wallet-collection state machine over an interaction + turn text.
 * No I/O. Identity checks are the caller's responsibility (same author_x_user_id).
 *
 * Produces deterministic speechFacts; live expression is Book of Speech (P1D.1).
 *
 * Confirmation classification (awaiting_wallet_confirmation):
 * - clean affirmative → confirm stored candidate
 * - explicit negative → clear candidate
 * - exactly one NEW valid EVM address → candidate_replaced
 * - same address again / no address / amount talk / ambiguous → re-ask confirmation
 *   (candidate_replaced ONLY when address is new and different)
 */

import type { EconomicInteractionRow } from "@/lib/agent/economic-interaction";
import {
  extractCandidateWalletFromText,
  isAffirmativeWalletConfirmation,
  isNegativeWalletConfirmation,
} from "@/lib/agent/wallet-collection";
import {
  speechFactsDestinationConfirmation,
  speechFactsDestinationConfirmedPending,
  speechFactsDestinationExpired,
  speechFactsDestinationInvalid,
  speechFactsDestinationRejected,
  type WalletSpeechFacts,
} from "@/lib/agent/wallet-speech-facts";

export type WalletTurnDecision =
  | {
      kind: "ignored_wrong_user";
      speechFacts: null;
    }
  | {
      kind: "expired";
      nextStatus: "expired";
      speechFacts: WalletSpeechFacts;
    }
  | {
      kind: "remain_awaiting_wallet";
      speechFacts: WalletSpeechFacts;
      reason: string;
    }
  | {
      kind: "candidate_set";
      nextStatus: "awaiting_wallet_confirmation";
      candidateWallet: string;
      speechFacts: WalletSpeechFacts;
    }
  | {
      kind: "candidate_replaced";
      nextStatus: "awaiting_wallet_confirmation";
      candidateWallet: string;
      speechFacts: WalletSpeechFacts;
    }
  | {
      /**
       * No new wallet; not a clean yes/no.
       * Candidate unchanged; confirmation still required.
       */
      kind: "ambiguous_confirmation";
      nextStatus: "awaiting_wallet_confirmation";
      candidateWallet: string;
      speechFacts: WalletSpeechFacts;
      reason: string;
    }
  | {
      kind: "back_to_awaiting_wallet";
      nextStatus: "awaiting_wallet";
      clearCandidate: true;
      speechFacts: WalletSpeechFacts;
    }
  | {
      kind: "confirmed";
      nextStatus: "wallet_confirmed";
      confirmedWallet: string;
      speechFacts: WalletSpeechFacts;
      /** Frozen original amount — never taken from user text. */
      proposedAmount: string;
      economicReason: string;
    }
  | {
      kind: "noop_terminal";
      speechFacts: null;
    };

function isExpired(
  interaction: EconomicInteractionRow,
  now: Date,
): boolean {
  return new Date(interaction.expiresAt).getTime() <= now.getTime();
}

function reaskConfirmation(
  candidateWallet: string,
  reason: string,
): WalletTurnDecision {
  return {
    kind: "ambiguous_confirmation",
    nextStatus: "awaiting_wallet_confirmation",
    candidateWallet,
    speechFacts: speechFactsDestinationConfirmation(candidateWallet),
    reason,
  };
}

/**
 * Process one reply turn against a pending transfer interaction.
 * Does not re-price amount. User amount talk is ignored for settlement.
 */
export function decideWalletCollectionTurn(input: {
  interaction: EconomicInteractionRow;
  /** Must equal interaction.authorXUserId or turn is ignored. */
  authorXUserId: string;
  body: string;
  now?: Date;
}): WalletTurnDecision {
  const now = input.now ?? new Date();
  const interaction = input.interaction;
  const author = input.authorXUserId.trim();

  if (author !== interaction.authorXUserId.trim()) {
    return { kind: "ignored_wrong_user", speechFacts: null };
  }

  if (
    interaction.status === "completed" ||
    interaction.status === "cancelled" ||
    interaction.status === "failed" ||
    interaction.status === "expired" ||
    interaction.status === "executing"
  ) {
    return { kind: "noop_terminal", speechFacts: null };
  }

  if (isExpired(interaction, now)) {
    return {
      kind: "expired",
      nextStatus: "expired",
      speechFacts: speechFactsDestinationExpired(),
    };
  }

  const body = input.body ?? "";
  const extracted = extractCandidateWalletFromText(body);

  if (interaction.status === "awaiting_wallet") {
    if (extracted.ok) {
      return {
        kind: "candidate_set",
        nextStatus: "awaiting_wallet_confirmation",
        candidateWallet: extracted.walletAddress,
        speechFacts: speechFactsDestinationConfirmation(extracted.walletAddress),
      };
    }
    return {
      kind: "remain_awaiting_wallet",
      speechFacts: speechFactsDestinationInvalid(),
      reason: extracted.reason,
    };
  }

  if (interaction.status === "awaiting_wallet_confirmation") {
    const stored = interaction.candidateWallet;

    // Exactly one valid EVM address in this message.
    if (extracted.ok) {
      // Same stored candidate again — confirm only on clean affirmative;
      // never label as candidate_replaced.
      if (stored && extracted.walletAddress === stored) {
        if (isAffirmativeWalletConfirmation(body)) {
          return confirm(interaction, extracted.walletAddress);
        }
        return reaskConfirmation(stored, "same_candidate_resubmitted");
      }
      // New / different valid address → real replacement.
      return {
        kind: "candidate_replaced",
        nextStatus: "awaiting_wallet_confirmation",
        candidateWallet: extracted.walletAddress,
        speechFacts: speechFactsDestinationConfirmation(extracted.walletAddress),
      };
    }

    // Explicit negative (no address) → clear candidate.
    if (isNegativeWalletConfirmation(body)) {
      return {
        kind: "back_to_awaiting_wallet",
        nextStatus: "awaiting_wallet",
        clearCandidate: true,
        speechFacts: speechFactsDestinationRejected(),
      };
    }

    // Clean affirmative only (not "yes, but send 100000") → confirm.
    if (isAffirmativeWalletConfirmation(body) && stored) {
      return confirm(interaction, stored);
    }

    // Ambiguous: amount chat, partial yes, empty junk — no wallet, no clean confirm.
    if (stored) {
      return reaskConfirmation(stored, "ambiguous_confirmation");
    }

    return {
      kind: "back_to_awaiting_wallet",
      nextStatus: "awaiting_wallet",
      clearCandidate: true,
      speechFacts: speechFactsDestinationInvalid(),
    };
  }

  return { kind: "noop_terminal", speechFacts: null };
}

function confirm(
  interaction: EconomicInteractionRow,
  wallet: string,
): WalletTurnDecision {
  return {
    kind: "confirmed",
    nextStatus: "wallet_confirmed",
    confirmedWallet: wallet,
    proposedAmount: interaction.proposedAmount,
    economicReason: interaction.economicReason,
    speechFacts: speechFactsDestinationConfirmedPending({
      proposedAmount: interaction.proposedAmount,
      confirmedWallet: wallet,
    }),
  };
}
