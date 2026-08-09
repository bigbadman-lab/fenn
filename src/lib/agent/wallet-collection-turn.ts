/**
 * Stage P1D — pure wallet-collection state machine over an interaction + turn text.
 * No I/O. Identity checks are the caller's responsibility (same author_x_user_id).
 *
 * Produces deterministic speechFacts; live expression is Book of Speech (P1D.1).
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
    if (extracted.ok) {
      if (
        interaction.candidateWallet &&
        extracted.walletAddress === interaction.candidateWallet
      ) {
        if (isAffirmativeWalletConfirmation(body)) {
          return confirm(interaction, extracted.walletAddress);
        }
        return {
          kind: "candidate_replaced",
          nextStatus: "awaiting_wallet_confirmation",
          candidateWallet: extracted.walletAddress,
          speechFacts: speechFactsDestinationConfirmation(extracted.walletAddress),
        };
      }
      return {
        kind: "candidate_replaced",
        nextStatus: "awaiting_wallet_confirmation",
        candidateWallet: extracted.walletAddress,
        speechFacts: speechFactsDestinationConfirmation(extracted.walletAddress),
      };
    }

    if (isNegativeWalletConfirmation(body)) {
      return {
        kind: "back_to_awaiting_wallet",
        nextStatus: "awaiting_wallet",
        clearCandidate: true,
        speechFacts: speechFactsDestinationRejected(),
      };
    }

    if (
      isAffirmativeWalletConfirmation(body) &&
      interaction.candidateWallet
    ) {
      return confirm(interaction, interaction.candidateWallet);
    }

    if (interaction.candidateWallet) {
      return {
        kind: "candidate_replaced",
        nextStatus: "awaiting_wallet_confirmation",
        candidateWallet: interaction.candidateWallet,
        speechFacts: speechFactsDestinationConfirmation(
          interaction.candidateWallet,
        ),
      };
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
