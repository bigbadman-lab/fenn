/**
 * Canonical Swap event topics and pool ABIs for V2/V3-style pools.
 * No guessing for custom pool kinds.
 */

import { keccak256, toBytes } from "viem";

import type { MarketWatchPoolKind } from "@/lib/market-watch/types";

/** Uniswap V2 Pair Swap(address,uint256,uint256,uint256,uint256,address) */
export const UNISWAP_V2_SWAP_SIGNATURE =
  "Swap(address,uint256,uint256,uint256,uint256,address)";

/**
 * Uniswap V3 Pool Swap(address,address,int256,int256,uint160,uint128,int24)
 */
export const UNISWAP_V3_SWAP_SIGNATURE =
  "Swap(address,address,int256,int256,uint160,uint128,int24)";

export const UNISWAP_V2_SWAP_TOPIC = keccak256(
  toBytes(UNISWAP_V2_SWAP_SIGNATURE),
);
export const UNISWAP_V3_SWAP_TOPIC = keccak256(
  toBytes(UNISWAP_V3_SWAP_SIGNATURE),
);

export const POOL_TOKEN_ORDER_ABI = [
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** V2 Swap non-indexed amounts decoded from data. */
export const UNISWAP_V2_SWAP_ABI = [
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "amount0In", type: "uint256", indexed: false },
      { name: "amount1In", type: "uint256", indexed: false },
      { name: "amount0Out", type: "uint256", indexed: false },
      { name: "amount1Out", type: "uint256", indexed: false },
      { name: "to", type: "address", indexed: true },
    ],
  },
] as const;

/** V3 Swap amounts decoded from data (sender/recipient indexed). */
export const UNISWAP_V3_SWAP_ABI = [
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount0", type: "int256", indexed: false },
      { name: "amount1", type: "int256", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "tick", type: "int24", indexed: false },
    ],
  },
] as const;

export function swapTopicForPoolKind(
  poolKind: MarketWatchPoolKind,
): `0x${string}` | null {
  if (poolKind === "uniswap_v2") return UNISWAP_V2_SWAP_TOPIC;
  if (poolKind === "uniswap_v3") return UNISWAP_V3_SWAP_TOPIC;
  return null;
}
