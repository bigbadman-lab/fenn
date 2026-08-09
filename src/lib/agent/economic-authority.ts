/**
 * Stage P1B/P1C economic authority — plans transfer_fenn / burn_fenn effects.
 * Pure rules over trusted application fields. Model reason is audit-only.
 *
 * P1C: amount is the exact validated model proposedAmount (never clamped).
 * Authority may only permit or refuse.
 */

import {
  stage12BurnFennEffectIdempotencyKey,
  stage12TransferFennEffectIdempotencyKey,
  type Stage125PolicyCode,
} from "@/lib/agent/authority-config";
import {
  compareEconomicAmountFormatted,
  isEconomicAmountPositiveAndAtMost,
  parseEconomicProposedAmount,
  sumEconomicAmountFormatted,
} from "@/lib/agent/economic-amount";
import {
  loadEconomicAuthorityLimits,
  type EconomicAuthorityLimits,
} from "@/lib/agent/economic-authority-limits";
import type { FinalEconomicIntent } from "@/lib/agent/economic-intent";
import type { AuthorityEffectPlan } from "@/lib/agent/authority-policy";
import type { PurseEconomicState } from "@/lib/agent/purse-economic-context";
import { resolveTrustedTransferRecipient } from "@/lib/agent/trusted-recipient";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";
import { isHardBlockReasonCode } from "@/lib/agent/reply-guarantee-policy";
import { parseEvmAddress } from "@/lib/wallet/evm";

export type EconomicAuthorityContext = {
  economicIntent: FinalEconomicIntent;
  reasonCode: string | null | undefined;
  /** Perception id used for deterministic effect keys. */
  perceptionEventId: string;
  /** Operator/harness bound wallet. */
  harnessBoundWallet?: string | null;
  /**
   * Stage P1D: wallet confirmed for a specific economic_interaction only.
   * Never a permanent X→wallet profile binding.
   */
  interactionConfirmedWallet?: string | null;
  /**
   * Stage P1D interaction id for deterministic transfer effect idempotency.
   * When set, transfer keys use ei:<id> rather than perception alone.
   */
  economicInteractionId?: string | null;
  purseState: Pick<
    PurseEconomicState,
    | "isEnabled"
    | "economicExecutionEnabled"
    | "environment"
    | "testRailExplicitlyActive"
    | "officialFennAvailable"
    | "remainingBalanceFormatted"
    | "rolling24hOutflowFormatted"
    | "tokenDecimals"
  > | null;
  /**
   * Live path: always "official".
   * P1B harness: "p1a_test".
   * Never read from model.
   */
  executionRail: "official" | "p1a_test";
  /**
   * Optional hard gate. When false, refuse regardless of amount.
   * When true/undefined, amount is compared to remaining balance if known.
   */
  sufficientBalance?: boolean;
  /** Optional override (defaults from env/TEST defaults). */
  limits?: EconomicAuthorityLimits;
};

export type EconomicPlanResult = {
  effects: AuthorityEffectPlan[];
  /** Informative: why economic effect was skipped (not a denial of speech). */
  skippedReason: string | null;
  policyHint: Stage125PolicyCode | null;
  /**
   * P1D: transfer intent is valid but destination is missing.
   * Not ordinary NONE — original amount/reason must be preserved.
   */
  pendingDestination?: boolean;
};

function refuse(
  reason: string,
  extra?: { pendingDestination?: boolean; policyHint?: Stage125PolicyCode | null },
): EconomicPlanResult {
  return {
    effects: [],
    skippedReason: reason,
    policyHint: extra?.policyHint ?? null,
    pendingDestination: extra?.pendingDestination === true,
  };
}

function proposedAmountOrRefuse(
  intent: Extract<FinalEconomicIntent, { proposedAmount: string }>,
): { ok: true; amount: string } | { ok: false; reason: string } {
  try {
    return {
      ok: true,
      amount: parseEconomicProposedAmount(intent.proposedAmount),
    };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "economic_amount_malformed";
    return { ok: false, reason: msg };
  }
}

function checkBalance(
  amount: string,
  ctx: EconomicAuthorityContext,
): string | null {
  if (ctx.sufficientBalance === false) {
    return "insufficient_balance";
  }
  const remaining = ctx.purseState?.remainingBalanceFormatted;
  const decimals = ctx.purseState?.tokenDecimals ?? 18;
  if (remaining != null && remaining.trim() !== "") {
    try {
      if (
        compareEconomicAmountFormatted(amount, remaining, decimals) > 0
      ) {
        return "insufficient_balance";
      }
    } catch {
      return "insufficient_balance";
    }
  }
  return null;
}

function checkRolling24h(
  amount: string,
  ctx: EconomicAuthorityContext,
  limits: EconomicAuthorityLimits,
): string | null {
  const decimals = ctx.purseState?.tokenDecimals ?? 18;
  const prior = ctx.purseState?.rolling24hOutflowFormatted ?? "0";
  try {
    const projected = sumEconomicAmountFormatted(
      [prior, amount],
      decimals,
    );
    if (
      !isEconomicAmountPositiveAndAtMost(
        projected,
        limits.maxRolling24hOutflowFormatted,
        decimals,
      )
    ) {
      // Never clamp — refuse the whole action.
      return "amount_exceeds_rolling_24h_limit";
    }
  } catch {
    return "amount_exceeds_rolling_24h_limit";
  }
  return null;
}

/**
 * Map economic intent → zero or one economic effect plan.
 * Never trusts model recipient/token/rail fields.
 * Never clamps proposedAmount — only permit or refuse.
 */
export function planEconomicEffects(
  ctx: EconomicAuthorityContext,
): EconomicPlanResult {
  if (isHardBlockReasonCode(ctx.reasonCode)) {
    return refuse("hard_block");
  }

  const intent = ctx.economicIntent;
  if (!intent || intent.type === "NONE") {
    return refuse("none");
  }

  if (!ctx.purseState?.isEnabled || !ctx.purseState.economicExecutionEnabled) {
    return refuse("purse_unavailable");
  }

  // Live traffic must never silently use disposable rail.
  if (
    ctx.executionRail === "p1a_test" &&
    !ctx.purseState.testRailExplicitlyActive
  ) {
    return refuse("test_rail_forbidden");
  }

  if (
    ctx.executionRail === "official" &&
    !ctx.purseState.officialFennAvailable
  ) {
    return refuse("official_fenn_unavailable");
  }

  const eventKey = ctx.perceptionEventId.trim();
  if (!eventKey) {
    return refuse("missing_event");
  }

  const limits = ctx.limits ?? loadEconomicAuthorityLimits();
  const decimals = ctx.purseState.tokenDecimals ?? 18;
  const eventKeyBase = eventKey;

  if (intent.type === "transfer_fenn") {
    if (intent.recipientSource !== "trusted_profile_wallet") {
      return refuse("invalid_recipient_source");
    }

    const amountResult = proposedAmountOrRefuse(intent);
    if (!amountResult.ok) {
      return refuse(amountResult.reason);
    }
    const amount = amountResult.amount;

    if (
      !isEconomicAmountPositiveAndAtMost(
        amount,
        limits.maxSingleTransferFormatted,
        decimals,
      )
    ) {
      // NEVER clamp — refuse rather than rewrite FENN's amount.
      return refuse("amount_exceeds_transfer_limit");
    }

    const bal = checkBalance(amount, ctx);
    if (bal) return refuse(bal);

    const rolling = checkRolling24h(amount, ctx, limits);
    if (rolling) return refuse(rolling);

    const resolved = resolveTrustedTransferRecipient({
      harnessBoundWallet: ctx.harnessBoundWallet,
      interactionConfirmedWallet: ctx.interactionConfirmedWallet,
    });
    if (!resolved.ok) {
      // Intent + magnitude already checked. Missing destination is P1D pending.
      return refuse("pending_destination", {
        pendingDestination: true,
        policyHint: "pending_destination",
      });
    }

    const eventKey = ctx.economicInteractionId?.trim()
      ? `ei:${ctx.economicInteractionId.trim()}`
      : `p1b:${eventKeyBase}`;

    return {
      effects: [
        {
          type: "transfer_fenn",
          idempotencyKey: stage12TransferFennEffectIdempotencyKey(eventKey),
          payload: {
            recipientAddress: resolved.walletAddress,
            amountFormatted: amount,
            executionRail: ctx.executionRail,
            economicReason: intent.reason,
            recipientSource: intent.recipientSource,
            ...(ctx.economicInteractionId
              ? { economicInteractionId: ctx.economicInteractionId }
              : {}),
            recipientTrust:
              resolved.source === "economic_interaction"
                ? "economic_interaction"
                : resolved.source,
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

    const amountResult = proposedAmountOrRefuse(intent);
    if (!amountResult.ok) {
      return refuse(amountResult.reason);
    }
    const amount = amountResult.amount;

    if (
      !isEconomicAmountPositiveAndAtMost(
        amount,
        limits.maxSingleBurnFormatted,
        decimals,
      )
    ) {
      return refuse("amount_exceeds_burn_limit");
    }

    const bal = checkBalance(amount, ctx);
    if (bal) return refuse(bal);

    const rolling = checkRolling24h(amount, ctx, limits);
    if (rolling) return refuse(rolling);

    return {
      effects: [
        {
          type: "burn_fenn",
          idempotencyKey: stage12BurnFennEffectIdempotencyKey(
            `p1b:${eventKey}`,
          ),
          payload: {
            amountFormatted: amount,
            executionRail: ctx.executionRail,
            economicReason: intent.reason,
          },
        },
      ],
      skippedReason: null,
      policyHint: "permitted_burn_p1b",
    };
  }

  return refuse("none");
}
