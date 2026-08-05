/**
 * Decode official pool Swap logs by pool kind. custom → fail closed.
 */

import { decodeEventLog, type Hex, type Log } from "viem";

import { classifyV2Swap } from "@/lib/market-watch/classify-v2";
import { classifyV3Swap } from "@/lib/market-watch/classify-v3";
import { MARKET_WATCH_CLASSIFICATION_VERSION } from "@/lib/market-watch/config";
import {
  UNISWAP_V2_SWAP_ABI,
  UNISWAP_V2_SWAP_TOPIC,
  UNISWAP_V3_SWAP_ABI,
  UNISWAP_V3_SWAP_TOPIC,
} from "@/lib/market-watch/topics";
import type {
  CanonicalSwapLog,
  ClassifyResult,
  MarketWatchPoolKind,
  MarketWatchTokenOrder,
} from "@/lib/market-watch/types";
import { parseEvmAddress } from "@/lib/wallet/evm";

export function toCanonicalSwapLog(log: {
  address: string;
  topics: readonly string[] | readonly Hex[];
  data: string | Hex;
  blockNumber: bigint | null;
  blockHash?: string | null;
  transactionHash: string | null;
  logIndex: number | null;
}): CanonicalSwapLog | null {
  if (
    log.blockNumber == null ||
    log.transactionHash == null ||
    log.logIndex == null
  ) {
    return null;
  }
  let address: string;
  try {
    address = parseEvmAddress(log.address);
  } catch {
    return null;
  }
  const topics = log.topics.map((t) => t.toLowerCase());
  return {
    address,
    topics,
    data: log.data.toLowerCase() as string,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash ? log.blockHash.toLowerCase() : null,
    transactionHash: log.transactionHash.toLowerCase(),
    logIndex: log.logIndex,
  };
}

/**
 * Decode + classify one Swap log. topic mismatch → suppress (not hard error).
 */
export function decodeAndClassifySwap(input: {
  log: CanonicalSwapLog;
  poolKind: MarketWatchPoolKind;
  expectedPool: string;
  expectedTopic: string;
  order: MarketWatchTokenOrder;
  classificationVersion?: string;
}): ClassifyResult | { kind: "error"; reason: string } {
  const version =
    input.classificationVersion ?? MARKET_WATCH_CLASSIFICATION_VERSION;
  const pool = parseEvmAddress(input.expectedPool);
  if (input.log.address !== pool) {
    return { kind: "error", reason: "log_pool_mismatch" };
  }
  if (input.poolKind === "custom") {
    return { kind: "error", reason: "unsupported_pool_kind" };
  }

  const topic0 = input.log.topics[0]?.toLowerCase();
  if (!topic0 || topic0 !== input.expectedTopic.toLowerCase()) {
    return { kind: "suppress", reason: "topic_mismatch" };
  }

  try {
    if (input.poolKind === "uniswap_v2") {
      if (topic0 !== UNISWAP_V2_SWAP_TOPIC.toLowerCase()) {
        return { kind: "suppress", reason: "topic_mismatch" };
      }
      const decoded = decodeEventLog({
        abi: UNISWAP_V2_SWAP_ABI,
        data: input.log.data as Hex,
        topics: input.log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "Swap") {
        return { kind: "suppress", reason: "unexpected_event" };
      }
      const args = decoded.args as {
        amount0In: bigint;
        amount1In: bigint;
        amount0Out: bigint;
        amount1Out: bigint;
      };
      return classifyV2Swap(
        {
          amount0In: args.amount0In,
          amount1In: args.amount1In,
          amount0Out: args.amount0Out,
          amount1Out: args.amount1Out,
        },
        input.order,
        version,
      );
    }

    if (input.poolKind === "uniswap_v3") {
      if (topic0 !== UNISWAP_V3_SWAP_TOPIC.toLowerCase()) {
        return { kind: "suppress", reason: "topic_mismatch" };
      }
      const decoded = decodeEventLog({
        abi: UNISWAP_V3_SWAP_ABI,
        data: input.log.data as Hex,
        topics: input.log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "Swap") {
        return { kind: "suppress", reason: "unexpected_event" };
      }
      const args = decoded.args as {
        amount0: bigint;
        amount1: bigint;
      };
      return classifyV3Swap(
        { amount0: args.amount0, amount1: args.amount1 },
        input.order,
        version,
      );
    }

    return { kind: "error", reason: "unsupported_pool_kind" };
  } catch {
    return { kind: "error", reason: "decode_failed" };
  }
}

export function logFromViem(log: Log): CanonicalSwapLog | null {
  return toCanonicalSwapLog({
    address: log.address,
    topics: log.topics,
    data: log.data,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
  });
}
