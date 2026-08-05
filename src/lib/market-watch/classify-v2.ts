/**
 * Uniswap V2-style Swap classification (pool perspective).
 * Acquisition: quote enters pool, FENN leaves pool.
 * Disposal: FENN enters pool, quote leaves pool.
 */

import { MARKET_WATCH_CLASSIFICATION_VERSION } from "@/lib/market-watch/config";
import type { ClassifyResult } from "@/lib/market-watch/types";
import type { MarketWatchTokenOrder } from "@/lib/market-watch/types";

export type V2SwapAmounts = {
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
};

const ZERO = BigInt(0);

function isNonNeg(n: bigint): boolean {
  return n >= ZERO;
}

/**
 * Pure V2 classification. Amounts must be non-negative uint256 values.
 */
export function classifyV2Swap(
  amounts: V2SwapAmounts,
  order: MarketWatchTokenOrder,
  classificationVersion: string = MARKET_WATCH_CLASSIFICATION_VERSION,
): ClassifyResult {
  const { amount0In, amount1In, amount0Out, amount1Out } = amounts;
  if (
    !isNonNeg(amount0In) ||
    !isNonNeg(amount1In) ||
    !isNonNeg(amount0Out) ||
    !isNonNeg(amount1Out)
  ) {
    return { kind: "suppress", reason: "negative_v2_amount" };
  }

  // Reject simultaneous in+out on the same side (malformed / dual-direction noise).
  if (
    (amount0In > ZERO && amount0Out > ZERO) ||
    (amount1In > ZERO && amount1Out > ZERO)
  ) {
    return { kind: "suppress", reason: "dual_direction_v2" };
  }

  const fennIn = order.fennIsToken0 ? amount0In : amount1In;
  const fennOut = order.fennIsToken0 ? amount0Out : amount1Out;
  const quoteIn = order.fennIsToken0 ? amount1In : amount0In;
  const quoteOut = order.fennIsToken0 ? amount1Out : amount0Out;

  if (fennIn > ZERO && quoteOut > ZERO && fennOut === ZERO && quoteIn === ZERO) {
    return {
      kind: "ok",
      eventType: "disposal",
      fennAmountRaw: fennIn,
      quoteAmountRaw: quoteOut,
      classificationVersion,
    };
  }

  if (quoteIn > ZERO && fennOut > ZERO && fennIn === ZERO && quoteOut === ZERO) {
    return {
      kind: "ok",
      eventType: "acquisition",
      fennAmountRaw: fennOut,
      quoteAmountRaw: quoteIn,
      classificationVersion,
    };
  }

  if (fennIn === ZERO && fennOut === ZERO) {
    return { kind: "suppress", reason: "zero_fenn_amount" };
  }

  if (fennOut === ZERO && fennIn === ZERO) {
    return { kind: "suppress", reason: "zero_output" };
  }

  return { kind: "suppress", reason: "malformed_v2_swap" };
}
