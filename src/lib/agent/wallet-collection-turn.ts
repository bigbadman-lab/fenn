/**
 * Stage P1D — pure wallet-collection state machine over an interaction + turn text.
 * No I/O. Identity checks are the caller's responsibility (same author_x_user_id).
 */

import type { EconomicInteractionRow } from "@/lib/agent/economic-interaction";
import {
  buildAskWalletConfirmationReply,
  buildWalletAskAgainReply,
  buildWalletConfirmedProceedingReply,
  buildWalletRejectedReply,
  extractCandidateWalletFromText,
  isAffirmativeWalletConfirmation,
  isNegativeWalletConfirmation,
} from "@/lib/agent/wallet-collection";

export type WalletTurnDecision =
  | {
      kind: "ignored_wrong_user";
      speech: null;
    }
  | {
      kind: "expired";
      nextStatus: "expired";
      speech: string;
    }
  | {
      kind: "remain_awaiting_wallet";
      speech: string;
      reason: string;
    }
  | {
      kind: "candidate_set";
      nextStatus: "awaiting_wallet_confirmation";
      candidateWallet: string;
      speech: string;
    }
  | {
      kind: "candidate_replaced";
      nextStatus: "awaiting_wallet_confirmation";
      candidateWallet: string;
      speech: string;
    }
  | {
      kind: "back_to_awaiting_wallet";
      nextStatus: "awaiting_wallet";
      clearCandidate: true;
      speech: string;
    }
  | {
      kind: "confirmed";
      nextStatus: "wallet_confirmed";
      confirmedWallet: string;
      speech: string;
      /** Frozen original amount — never taken from user text. */
      proposedAmount: string;
      economicReason: string;
    }
  | {
      kind: "noop_terminal";
      speech: null;
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
    return { kind: "ignored_wrong_user", speech: null };
  }

  if (
    interaction.status === "completed" ||
    interaction.status === "cancelled" ||
    interaction.status === "failed" ||
    interaction.status === "expired" ||
    interaction.status === "executing"
  ) {
    return { kind: "noop_terminal", speech: null };
  }

  if (isExpired(interaction, now)) {
    return {
      kind: "expired",
      nextStatus: "expired",
      speech:
        "That pending transfer lapsed before a destination was confirmed. Nothing was sent.",
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
        speech: buildAskWalletConfirmationReply({
          candidateWallet: extracted.walletAddress,
        }),
      };
    }
    return {
      kind: "remain_awaiting_wallet",
      speech: buildWalletAskAgainReply(),
      reason: extracted.reason,
    };
  }

  if (interaction.status === "awaiting_wallet_confirmation") {
    // Replacement address takes priority over bare yes/no.
    if (extracted.ok) {
      if (
        interaction.candidateWallet &&
        extracted.walletAddress === interaction.candidateWallet
      ) {
        // Same address again — treat as confirmation if also affirmative,
        // otherwise re-ask confirm.
        if (isAffirmativeWalletConfirmation(body)) {
          return confirm(interaction, extracted.walletAddress);
        }
        return {
          kind: "candidate_replaced",
          nextStatus: "awaiting_wallet_confirmation",
          candidateWallet: extracted.walletAddress,
          speech: buildAskWalletConfirmationReply({
            candidateWallet: extracted.walletAddress,
          }),
        };
      }
      return {
        kind: "candidate_replaced",
        nextStatus: "awaiting_wallet_confirmation",
        candidateWallet: extracted.walletAddress,
        speech: buildAskWalletConfirmationReply({
          candidateWallet: extracted.walletAddress,
        }),
      };
    }

    if (isNegativeWalletConfirmation(body)) {
      return {
        kind: "back_to_awaiting_wallet",
        nextStatus: "awaiting_wallet",
        clearCandidate: true,
        speech: buildWalletRejectedReply(),
      };
    }

    if (
      isAffirmativeWalletConfirmation(body) &&
      interaction.candidateWallet
    ) {
      return confirm(interaction, interaction.candidateWallet);
    }

    // Ambiguous (e.g. amount-only or unclear) — re-ask confirmation.
    if (interaction.candidateWallet) {
      return {
        kind: "candidate_replaced",
        nextStatus: "awaiting_wallet_confirmation",
        candidateWallet: interaction.candidateWallet,
        speech: buildAskWalletConfirmationReply({
          candidateWallet: interaction.candidateWallet,
        }),
      };
    }

    return {
      kind: "back_to_awaiting_wallet",
      nextStatus: "awaiting_wallet",
      clearCandidate: true,
      speech: buildWalletAskAgainReply(),
    };
  }

  // wallet_confirmed awaiting re-entry elsewhere
  return { kind: "noop_terminal", speech: null };
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
    speech: buildWalletConfirmedProceedingReply({
      proposedAmount: interaction.proposedAmount,
      confirmedWallet: wallet,
    }),
  };
}
