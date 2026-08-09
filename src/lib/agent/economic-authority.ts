/**
 * Stage P1B economic authority — plans transfer_fenn / burn_fenn effects.
 * Pure rules over trusted application fields. Model reason is audit-only.
 */

import {
  stage12BurnFennEffectIdempotencyKey,
  stage12TransferFennEffectIdempotencyKey,
  type Stage125PolicyCode,
} from "@/lib/agent/authority-config";
import type { FinalEconomicIntent } from "@/lib/agent/economic-intent";
import type { AuthorityEffectPlan } from "@/lib/agent/authority-policy";
import type { PurseEconomicState } from "@/lib/agent/purse-economic-context";
import { resolveTrustedTransferRecipient } from "@/lib/agent/trusted-recipient";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";
import { P0_MANUAL_TRANSFER_AMOUNT_FORMATTED } from "@/lib/purse/constants";
import { isHardBlockReasonCode } from "@/lib/agent/reply-guarantee-policy";
import { parseEvmAddress } from "@/lib/wallet/evm";

export type EconomicAuthorityContext = {
  economicIntent: FinalEconomicIntent;
  reasonCode: string | null | undefined;
  /** Perception id used for deterministic effect keys. */
  perceptionEventId: string;
  /** Operator/harness bound wallet. */
  harnessBoundWallet?: string | null;
  purseState: Pick<
    PurseEconomicState,
    | "isEnabled"
    | "economicExecutionEnabled"
    | "environment"
    | "testRailExplicitlyActive"
    | "officialFennAvailable"
  > | null;
  /**
   * Live path: always "official".
   * P1B harness: "p1a_test".
   * Never read from model.
   */
  executionRail: "official" | "p1a_test";
  /** Optional pre-checked balance in formatted units (trusted). */
  sufficientBalance?: boolean;
};

export type EconomicPlanResult = {
  effects: AuthorityEffectPlan[];
  /** Informative: why economic effect was skipped (not a denial of speech). */
  skippedReason: string | null;
  policyHint: Stage125PolicyCode | null;
};

function hasUnitBalance(sufficient: boolean | undefined): boolean {
  // If not supplied, authority may still plan; execute fails closed on chain.
  // For hard live safety preferred when known.
  if (sufficient === false) return false;
  return true;
}

/**
 * Map economic intent → zero or one economic effect plan.
 * Never trusts model recipient/amount/token fields.
 */
export function planEconomicEffects(
  ctx: EconomicAuthorityContext,
): EconomicPlanResult {
  if (isHardBlockReasonCode(ctx.reasonCode)) {
    return {
      effects: [],
      skippedReason: "hard_block",
      policyHint: null,
    };
  }

  const intent = ctx.economicIntent;
  if (!intent || intent.type === "NONE") {
    return { effects: [], skippedReason: "none", policyHint: null };
  }

  if (!ctx.purseState?.isEnabled || !ctx.purseState.economicExecutionEnabled) {
    return {
      effects: [],
      skippedReason: "purse_unavailable",
      policyHint: null,
    };
  }

  // Live traffic must never silently use disposable rail.
  if (
    ctx.executionRail === "p1a_test" &&
    !ctx.purseState.testRailExplicitlyActive
  ) {
    return {
      effects: [],
      skippedReason: "test_rail_forbidden",
      policyHint: null,
    };
  }

  if (
    ctx.executionRail === "official" &&
    !ctx.purseState.officialFennAvailable
  ) {
    return {
      effects: [],
      skippedReason: "official_fenn_unavailable",
      policyHint: null,
    };
  }

  if (!hasUnitBalance(ctx.sufficientBalance)) {
    return {
      effects: [],
      skippedReason: "insufficient_balance",
      policyHint: null,
    };
  }

  const eventKey = ctx.perceptionEventId.trim();
  if (!eventKey) {
    return { effects: [], skippedReason: "missing_event", policyHint: null };
  }

  if (intent.type === "transfer_fenn") {
    if (intent.recipientSource !== "trusted_profile_wallet") {
      return {
        effects: [],
        skippedReason: "invalid_recipient_source",
        policyHint: null,
      };
    }

    const resolved = resolveTrustedTransferRecipient({
      harnessBoundWallet: ctx.harnessBoundWallet,
    });
    if (!resolved.ok) {
      return {
        effects: [],
        skippedReason: `no_trusted_wallet:${resolved.reason}`,
        policyHint: null,
      };
    }

    return {
      effects: [
        {
          type: "transfer_fenn",
          // One transfer intent per perception/judgement event.
          idempotencyKey: stage12TransferFennEffectIdempotencyKey(
            `p1b:${eventKey}`,
          ),
          payload: {
            recipientAddress: resolved.walletAddress,
            amountFormatted: P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
            executionRail: ctx.executionRail,
            // Audit only — not used for settlement.
            economicReason: intent.reason,
            recipientSource: intent.recipientSource,
          },
        },
      ],
      skippedReason: null,
      policyHint: "permitted_transfer_p1b",
    };
  }

  if (intent.type === "burn_fenn") {
    // Dead address is fixed server-side; payload must not include it.
    void parseEvmAddress(FENN_DEAD_ADDRESS);
    return {
      effects: [
        {
          type: "burn_fenn",
          idempotencyKey: stage12BurnFennEffectIdempotencyKey(
            `p1b:${eventKey}`,
          ),
          payload: {
            amountFormatted: P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
            executionRail: ctx.executionRail,
            economicReason: intent.reason,
          },
        },
      ],
      skippedReason: null,
      policyHint: "permitted_burn_p1b",
    };
  }

  return { effects: [], skippedReason: "none", policyHint: null };
}
