/**
 * Bounded HTTP RPC helpers for Market Watch (Robinhood Chain via viem).
 * Never log RPC URLs or keys.
 */

import "server-only";

import type { Hex, Log } from "viem";

import {
  classifyRpcFailure,
  nextRangeAfterLimitError,
  rpcBackoffMs,
} from "@/lib/market-watch/adaptive-range";
import { MarketWatchError } from "@/lib/market-watch/errors";
import { logMarketWatch } from "@/lib/market-watch/log";
import {
  MARKET_WATCH_BLOCK_RANGE_FLOOR,
  MARKET_WATCH_RPC_MAX_ATTEMPTS,
} from "@/lib/market-watch/thresholds";
import {
  createRobinhoodPublicClient,
  type RobinhoodPublicClient,
} from "@/lib/treasury/chain";
import { TreasuryError } from "@/lib/treasury/errors";

export type MarketWatchRpcClient = {
  getBlockNumber: () => Promise<bigint>;
  getBlock: (args: {
    blockNumber: bigint;
  }) => Promise<{ hash: Hex | null; timestamp: bigint; number: bigint | null }>;
  getLogs: (args: {
    address: `0x${string}`;
    fromBlock: bigint;
    toBlock: bigint;
    topics?: (Hex | Hex[] | null)[];
  }) => Promise<Log[]>;
  getTransaction?: (args: {
    hash: Hex;
  }) => Promise<{ from: string } | null>;
  getChainId?: () => Promise<number>;
};

export async function withRpcRetry<T>(
  op: () => Promise<T>,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    label?: string;
    random?: () => number;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? MARKET_WATCH_RPC_MAX_ATTEMPTS;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (error) {
      lastError = error;
      const classified = classifyRpcFailure(error);
      // Range limits are structural — adaptive getLogs handles them; do not burn retries.
      if (
        classified.kind === "range_limit" ||
        classified.kind === "malformed"
      ) {
        throw error;
      }
      if (i < attempts - 1) {
        if (classified.kind === "rate_limit") {
          logMarketWatch({
            event: "rpc_rate_limited",
            ok: false,
            code: "mw_rpc_rate_limited",
            detail: options.label ?? "rpc",
          });
        } else {
          logMarketWatch({
            event: "rpc_retry",
            ok: false,
            code: "mw_rpc_failed",
            detail: `${options.label ?? "rpc"}:${classified.kind}`,
          });
        }
        await sleep(
          rpcBackoffMs(i, options.baseDelayMs, undefined, random),
        );
      }
    }
  }
  if (lastError instanceof MarketWatchError) throw lastError;
  const classified = classifyRpcFailure(lastError);
  if (classified.kind === "rate_limit") {
    throw new MarketWatchError(
      "mw_rpc_rate_limited",
      "Robinhood Chain RPC rate limited",
      429,
    );
  }
  throw new MarketWatchError(
    "mw_rpc_failed",
    "Robinhood Chain RPC request failed",
    502,
  );
}

export function createMarketWatchRpcClient(
  rpcUrl?: string,
): MarketWatchRpcClient {
  let client: RobinhoodPublicClient;
  try {
    client = createRobinhoodPublicClient(rpcUrl);
  } catch (error) {
    if (error instanceof TreasuryError) {
      throw new MarketWatchError(
        "mw_rpc_unavailable",
        "Robinhood Chain RPC is not configured",
        503,
      );
    }
    throw error;
  }

  return {
    getBlockNumber: () => client.getBlockNumber(),
    getChainId: async () => {
      const id = await client.getChainId();
      return Number(id);
    },
    getBlock: async ({ blockNumber }) => {
      const block = await client.getBlock({ blockNumber });
      return {
        hash: block.hash,
        timestamp: block.timestamp,
        number: block.number,
      };
    },
    getLogs: async (args) =>
      client.getLogs({
        address: args.address,
        fromBlock: args.fromBlock,
        toBlock: args.toBlock,
        topics: args.topics,
      } as Parameters<RobinhoodPublicClient["getLogs"]>[0]),
    getTransaction: async ({ hash }) => {
      const tx = await client.getTransaction({ hash });
      return tx ? { from: tx.from } : null;
    },
  };
}

/**
 * Fetch Swap logs with adaptive range halving on provider range limits.
 * Returns logs plus the effective end block actually scanned.
 */
export async function fetchOfficialPoolSwapLogs(input: {
  rpc: MarketWatchRpcClient;
  poolAddress: string;
  swapTopic: string;
  fromBlock: bigint;
  toBlock: bigint;
  /** Optional initial max span (defaults to full requested range). */
  maxSpan?: number;
}): Promise<{ logs: Log[]; effectiveToBlock: bigint; rangeUsed: number }> {
  if (input.fromBlock > input.toBlock) {
    throw new MarketWatchError(
      "mw_range_invalid",
      "fromBlock exceeds toBlock",
      400,
    );
  }

  const fullSpan =
    Number(input.toBlock - input.fromBlock) + 1;
  let span = Math.min(
    input.maxSpan ?? fullSpan,
    fullSpan,
  );
  span = Math.max(MARKET_WATCH_BLOCK_RANGE_FLOOR, span);

  // Progressive try: shrink on range_limit errors within the same request.
  for (let attempt = 0; attempt < 8; attempt++) {
    const endCandidate =
      input.fromBlock + BigInt(span) - BigInt(1) > input.toBlock
        ? input.toBlock
        : input.fromBlock + BigInt(span) - BigInt(1);

    try {
      const logs = await withRpcRetry(
        () =>
          input.rpc.getLogs({
            address: input.poolAddress as `0x${string}`,
            fromBlock: input.fromBlock,
            toBlock: endCandidate,
            topics: [input.swapTopic as Hex],
          }),
        { label: "getLogs" },
      );
      const filtered = logs.filter((log) => {
        const t0 = log.topics[0]?.toLowerCase();
        return t0 === input.swapTopic.toLowerCase();
      });
      return {
        logs: filtered,
        effectiveToBlock: endCandidate,
        rangeUsed: span,
      };
    } catch (error) {
      const classified = classifyRpcFailure(error);
      if (
        classified.kind === "range_limit" &&
        span > MARKET_WATCH_BLOCK_RANGE_FLOOR
      ) {
        const next = nextRangeAfterLimitError(span);
        logMarketWatch({
          event: "range_reduced",
          ok: true,
          code: "mw_range_reduced",
          detail: `${span}->${next}`,
          fromBlock: input.fromBlock.toString(),
          toBlock: endCandidate.toString(),
        });
        span = next;
        continue;
      }
      throw error;
    }
  }

  throw new MarketWatchError(
    "mw_rpc_failed",
    "getLogs failed after adaptive range attempts",
    502,
  );
}

export async function getConfirmedHead(input: {
  rpc: MarketWatchRpcClient;
  confirmationDepth: number;
}): Promise<{ latest: bigint; confirmedHead: bigint }> {
  const latest = await withRpcRetry(() => input.rpc.getBlockNumber(), {
    label: "getBlockNumber",
  });
  const depth = BigInt(Math.max(1, input.confirmationDepth));
  const confirmedHead = latest > depth ? latest - depth : BigInt(0);
  return { latest, confirmedHead };
}

export async function readBlockMeta(
  rpc: MarketWatchRpcClient,
  blockNumber: bigint,
): Promise<{ hash: string | null; timestamp: string | null }> {
  const block = await withRpcRetry(
    () => rpc.getBlock({ blockNumber }),
    { label: "getBlock" },
  );
  const hash = block.hash ? block.hash.toLowerCase() : null;
  const timestamp =
    block.timestamp != null
      ? new Date(Number(block.timestamp) * 1000).toISOString()
      : null;
  return { hash, timestamp };
}

export async function assertRobinhoodChainId(
  rpc: MarketWatchRpcClient,
  expected = 4663,
): Promise<void> {
  if (!rpc.getChainId) return;
  const id = await withRpcRetry(() => rpc.getChainId!(), {
    label: "getChainId",
  });
  if (id !== expected) {
    logMarketWatch({
      event: "chain_mismatch",
      ok: false,
      code: "mw_chain_mismatch",
      detail: `got=${id}`,
    });
    throw new MarketWatchError(
      "mw_chain_mismatch",
      "RPC chain id is not Robinhood Chain 4663",
      502,
    );
  }
}
