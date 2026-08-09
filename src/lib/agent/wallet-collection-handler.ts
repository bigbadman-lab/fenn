/**
 * Stage P1D — apply wallet-collection turn + re-enter transfer planning.
 * Used by judge intercept and the controlled harness.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EconomicInteractionRow } from "@/lib/agent/economic-interaction";
import {
  findWalletTurnEconomicInteraction,
  markEconomicInteractionFailed,
  tryLinkTransferEffect,
  updateEconomicInteraction,
} from "@/lib/agent/economic-interaction-persist";
import { planEconomicEffects } from "@/lib/agent/economic-authority";
import type { PurseEconomicState } from "@/lib/agent/purse-economic-context";
import { decideWalletCollectionTurn } from "@/lib/agent/wallet-collection-turn";
import type { AuthorityEffectPlan } from "@/lib/agent/authority-policy";

export type WalletCollectionTurnResult = {
  handled: boolean;
  interaction: EconomicInteractionRow | null;
  /** Deterministic speech for this turn (no completion claim). */
  replyText: string | null;
  /**
   * When set, authorize should plan transfer_fenn with this frozen intent
   * + confirmed wallet (amount never from user text).
   */
  reenterTransfer?: {
    interactionId: string;
    proposedAmount: string;
    economicReason: string;
    confirmedWallet: string;
  } | null;
  kind: string;
};

/**
 * If this author has an awaiting wallet / confirmation interaction, process body.
 */
export async function processAuthorWalletCollectionTurn(input: {
  authorXUserId: string;
  xPostId: string;
  body: string;
  now?: Date;
  admin?: SupabaseClient;
}): Promise<WalletCollectionTurnResult> {
  const interaction = await findWalletTurnEconomicInteraction({
    authorXUserId: input.authorXUserId,
    admin: input.admin,
    now: input.now,
  });
  if (!interaction) {
    return {
      handled: false,
      interaction: null,
      replyText: null,
      reenterTransfer: null,
      kind: "no_active",
    };
  }

  const decision = decideWalletCollectionTurn({
    interaction,
    authorXUserId: input.authorXUserId,
    body: input.body,
    now: input.now,
  });

  if (decision.kind === "ignored_wrong_user" || decision.kind === "noop_terminal") {
    return {
      handled: decision.kind !== "ignored_wrong_user",
      interaction,
      replyText: null,
      reenterTransfer: null,
      kind: decision.kind,
    };
  }

  if (decision.kind === "expired") {
    const updated = await updateEconomicInteraction({
      id: interaction.id,
      patch: { status: "expired", lastError: "expired" },
      admin: input.admin,
    });
    return {
      handled: true,
      interaction: updated,
      replyText: decision.speech,
      reenterTransfer: null,
      kind: decision.kind,
    };
  }

  if (decision.kind === "remain_awaiting_wallet") {
    return {
      handled: true,
      interaction,
      replyText: decision.speech,
      reenterTransfer: null,
      kind: decision.kind,
    };
  }

  if (
    decision.kind === "candidate_set" ||
    decision.kind === "candidate_replaced"
  ) {
    const nowIso = (input.now ?? new Date()).toISOString();
    const updated = await updateEconomicInteraction({
      id: interaction.id,
      patch: {
        status: "awaiting_wallet_confirmation",
        candidateWallet: decision.candidateWallet,
        candidateSourceXPostId: input.xPostId,
        walletReceivedAt: nowIso,
        walletConfirmationRequestedAt: nowIso,
      },
      admin: input.admin,
    });
    return {
      handled: true,
      interaction: updated,
      replyText: decision.speech,
      reenterTransfer: null,
      kind: decision.kind,
    };
  }

  if (decision.kind === "back_to_awaiting_wallet") {
    const updated = await updateEconomicInteraction({
      id: interaction.id,
      patch: {
        status: "awaiting_wallet",
        candidateWallet: null,
        candidateSourceXPostId: null,
      },
      admin: input.admin,
    });
    return {
      handled: true,
      interaction: updated,
      replyText: decision.speech,
      reenterTransfer: null,
      kind: decision.kind,
    };
  }

  if (decision.kind === "confirmed") {
    const nowIso = (input.now ?? new Date()).toISOString();
    const updated = await updateEconomicInteraction({
      id: interaction.id,
      patch: {
        status: "wallet_confirmed",
        confirmedWallet: decision.confirmedWallet,
        candidateWallet: decision.confirmedWallet,
        confirmationSourceXPostId: input.xPostId,
        walletConfirmedAt: nowIso,
      },
      admin: input.admin,
    });
    return {
      handled: true,
      interaction: updated,
      replyText: decision.speech,
      reenterTransfer: {
        interactionId: updated.id,
        proposedAmount: decision.proposedAmount,
        economicReason: decision.economicReason,
        confirmedWallet: decision.confirmedWallet,
      },
      kind: decision.kind,
    };
  }

  return {
    handled: true,
    interaction,
    replyText: null,
    reenterTransfer: null,
    kind: "unknown",
  };
}

/**
 * Pure re-entry: plan transfer from frozen interaction decision + confirmed wallet.
 * Never takes amount from the latest user text.
 */
export function planTransferFromConfirmedInteraction(input: {
  interaction: EconomicInteractionRow;
  perceptionEventId: string;
  purseState: PurseEconomicState | null;
  executionRail: "official" | "p1a_test";
  sufficientBalance?: boolean;
}): {
  effects: AuthorityEffectPlan[];
  skippedReason: string | null;
  plannedAmount: string | null;
} {
  if (
    input.interaction.status !== "wallet_confirmed" &&
    input.interaction.status !== "executing"
  ) {
    return {
      effects: [],
      skippedReason: "interaction_not_confirmed",
      plannedAmount: null,
    };
  }
  if (input.interaction.transferEffectId) {
    return {
      effects: [],
      skippedReason: "already_linked_effect",
      plannedAmount: input.interaction.proposedAmount,
    };
  }
  if (!input.interaction.confirmedWallet) {
    return {
      effects: [],
      skippedReason: "missing_confirmed_wallet",
      plannedAmount: null,
    };
  }

  const planned = planEconomicEffects({
    economicIntent: {
      type: "transfer_fenn",
      proposedAmount: input.interaction.proposedAmount,
      reason: input.interaction.economicReason,
      recipientSource: "trusted_profile_wallet",
    },
    reasonCode: "answered_from_public_knowledge",
    perceptionEventId: input.perceptionEventId,
    interactionConfirmedWallet: input.interaction.confirmedWallet,
    economicInteractionId: input.interaction.id,
    purseState: input.purseState,
    executionRail: input.executionRail,
    sufficientBalance: input.sufficientBalance,
  });

  return {
    effects: planned.effects,
    skippedReason: planned.skippedReason,
    plannedAmount:
      planned.effects[0] &&
      typeof planned.effects[0].payload.amountFormatted === "string"
        ? String(planned.effects[0].payload.amountFormatted)
        : null,
  };
}

export async function refuseConfirmedInteraction(input: {
  interactionId: string;
  reason: string;
  admin?: SupabaseClient;
}): Promise<void> {
  await markEconomicInteractionFailed({
    interactionId: input.interactionId,
    reason: input.reason,
    admin: input.admin,
  });
}

export { tryLinkTransferEffect };
