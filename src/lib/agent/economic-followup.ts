/**
 * Post-confirmation economic speech helpers (Stage P1B / P1C).
 *
 * After a transfer_fenn / burn_fenn settlement is confirmed, speech may state
 * the completed action with trusted facts only — including exact confirmed amount.
 *
 * Does not invent a second autonomous agent. Callers supply trusted facts.
 * Pre-confirmation text must never claim completion.
 */

import { explorerTxUrl } from "@/lib/greenwood/hollow/explorer";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";

export type EconomicFollowupFacts = {
  actionType: "transfer" | "burn";
  /** Exact confirmed amount (decimal string). */
  amountFormatted: string;
  txHash: string;
  chainId?: number;
  recipientAddress?: string | null;
};

export type EconomicFollowupDraft = {
  text: string;
  explorerUrl: string | null;
  facts: EconomicFollowupFacts;
};

/**
 * Truth-first draft for a completed economic action.
 * Prefer Book of Speech generation later; trusted facts always carry exact amount.
 */
export function buildEconomicFollowupDraft(
  facts: EconomicFollowupFacts,
): EconomicFollowupDraft {
  const chainId = facts.chainId ?? ROBINHOOD_CHAIN_ID;
  const explorerUrl = explorerTxUrl(chainId, facts.txHash);
  const shortHash =
    facts.txHash.length > 14
      ? `${facts.txHash.slice(0, 10)}…`
      : facts.txHash;
  const amount = facts.amountFormatted.trim();

  let text: string;
  if (facts.actionType === "burn") {
    text = `${amount} FENN left my Purse for the dead address. It will not return. ${shortHash}`;
  } else {
    text = `${amount} FENN left my Purse. ${shortHash}`;
  }
  if (explorerUrl) {
    text = `${text} ${explorerUrl}`.slice(0, 280);
  }

  return { text, explorerUrl, facts };
}

/**
 * Idempotency key for a post-confirmation economic follow-up reply effect.
 * Distinct from the primary `xPostId:reply` key.
 */
export function stage12EconomicFollowupReplyIdempotencyKey(
  economicEffectId: string,
): string {
  const id = economicEffectId.trim();
  if (!id) throw new Error("economicEffectId must be non-empty");
  return `stage12:economic_followup:${id}`;
}

/**
 * Guard language for pre-confirmation drafts (used by tests).
 */
export function replyClaimsCompletedEconomicAction(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /i (have|just) (sent|transferred|burned)/.test(t) ||
    /transfer (is|was) complete/.test(t) ||
    /burn (is|was) complete/.test(t) ||
    /tx confirmed/.test(t)
  );
}
