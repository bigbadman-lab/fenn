/**
 * Robinhood Chain protocol constants for FENN Treasury reads.
 *
 * Verified against official Robinhood Chain documentation:
 * https://docs.robinhood.com/chain/connecting/
 * (mainnet Chain ID 4663; native gas token ETH)
 *
 * Chain ID is a fixed protocol constant — not deployment env.
 * RPC URL remains server-only via ROBINHOOD_CHAIN_RPC_URL.
 */
export const ROBINHOOD_CHAIN_ID = 4663 as const;

export const ROBINHOOD_NATIVE_CURRENCY = {
  name: "Ether",
  symbol: "ETH",
  decimals: 18,
} as const;

export const ROBINHOOD_CHAIN_SOURCE =
  "https://docs.robinhood.com/chain/connecting/" as const;
