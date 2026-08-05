/**
 * Pure token-order validation for official pool configuration.
 */

import type { MarketWatchTokenOrder } from "@/lib/market-watch/types";
import { parseEvmAddress } from "@/lib/wallet/evm";

/**
 * Confirm {token0, token1} equals {fenn, quote} in either order.
 */
export function resolveTokenOrder(input: {
  token0: string;
  token1: string;
  fennToken: string;
  quoteToken: string;
}): MarketWatchTokenOrder | { ok: false; reason: string } {
  let token0: string;
  let token1: string;
  let fenn: string;
  let quote: string;
  try {
    token0 = parseEvmAddress(input.token0);
    token1 = parseEvmAddress(input.token1);
    fenn = parseEvmAddress(input.fennToken);
    quote = parseEvmAddress(input.quoteToken);
  } catch {
    return { ok: false, reason: "invalid_address" };
  }

  if (token0 === token1) {
    return { ok: false, reason: "identical_pool_tokens" };
  }
  if (fenn === quote) {
    return { ok: false, reason: "identical_fenn_quote" };
  }

  const poolSet = new Set([token0, token1]);
  if (!poolSet.has(fenn) || !poolSet.has(quote)) {
    return { ok: false, reason: "pool_token_mismatch" };
  }

  return {
    token0,
    token1,
    fennIsToken0: token0 === fenn,
    quoteIsToken0: token0 === quote,
  };
}
