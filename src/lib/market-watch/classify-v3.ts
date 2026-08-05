/**
 * Uniswap V3-style Swap classification using pool balance deltas.
 * Positive delta = pool received that token; negative = pool sent that token.
 */

import { MARKET_WATCH_CLASSIFICATION_VERSION } from "@/lib/market-watch/config";
import type { ClassifyResult, MarketWatchTokenOrder } from "@/lib/market-watch/types";

export type V3SwapDeltas = {
  amount0: bigint;
  amount1: bigint;
};

const ZERO = BigInt(0);

function abs(n: bigint): bigint {
  return n < ZERO ? -n : n;
}

/**
 * Pure V3 classification from signed int256 pool deltas.
 */
export function classifyV3Swap(
  deltas: V3SwapDeltas,
  order: MarketWatchTokenOrder,
  classificationVersion: string = MARKET_WATCH_CLASSIFICATION_VERSION,
): ClassifyResult {
  const { amount0, amount1 } = deltas;

  // Zero both sides — not a trade.
  if (amount0 === ZERO && amount1 === ZERO) {
    return { kind: "suppress", reason: "zero_v3_deltas" };
  }

  // Same sign both sides is not a simple swap against the pool.
  if (
    (amount0 > ZERO && amount1 > ZERO) ||
    (amount0 < ZERO && amount1 < ZERO)
  ) {
    return { kind: "suppress", reason: "same_sign_v3_deltas" };
  }

  const fennDelta = order.fennIsToken0 ? amount0 : amount1;
  const quoteDelta = order.fennIsToken0 ? amount1 : amount0;

  // Acquisition: pool receives quote (+), sends FENN (−)
  if (quoteDelta > ZERO && fennDelta < ZERO) {
    const fennAmount = abs(fennDelta);
    const quoteAmount = quoteDelta;
    if (fennAmount === ZERO) {
      return { kind: "suppress", reason: "zero_fenn_amount" };
    }
    return {
      kind: "ok",
      eventType: "acquisition",
      fennAmountRaw: fennAmount,
      quoteAmountRaw: quoteAmount,
      classificationVersion,
    };
  }

  // Disposal: pool receives FENN (+), sends quote (−)
  if (fennDelta > ZERO && quoteDelta < ZERO) {
    const fennAmount = fennDelta;
    const quoteAmount = abs(quoteDelta);
    if (fennAmount === ZERO) {
      return { kind: "suppress", reason: "zero_fenn_amount" };
    }
    return {
      kind: "ok",
      eventType: "disposal",
      fennAmountRaw: fennAmount,
      quoteAmountRaw: quoteAmount,
      classificationVersion,
    };
  }

  return { kind: "suppress", reason: "malformed_v3_swap" };
}
