/**
 * Bounded HTTP RPC helpers for Market Watch (Robinhood Chain via viem).
 * Never log RPC URLs or keys.
 */

import "server-only";

import type { Hex, Log } from "viem";

import { MarketWatchError } from "@/lib/market-watch/errors";
import { logMarketWatch } from "@/lib/market-watch/log";
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
};

export async function withRpcRetry<T>(
  op: () => Promise<T>,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    label?: string;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        logMarketWatch({
          event: "rpc_retry",
          ok: false,
          code: "mw_rpc_failed",
          detail: options.label ?? "rpc",
        });
        await sleep(baseDelayMs * 2 ** i);
      }
    }
  }
  if (lastError instanceof MarketWatchError) throw lastError;
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
 * Fetch Swap logs for official pool address + topic only.
 */
export async function fetchOfficialPoolSwapLogs(input: {
  rpc: MarketWatchRpcClient;
  poolAddress: string;
  swapTopic: string;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<Log[]> {
  if (input.fromBlock > input.toBlock) {
    throw new MarketWatchError(
      "mw_range_invalid",
      "fromBlock exceeds toBlock",
      400,
    );
  }
  return withRpcRetry(
    () =>
      input.rpc.getLogs({
        address: input.poolAddress as `0x${string}`,
        fromBlock: input.fromBlock,
        toBlock: input.toBlock,
        topics: [input.swapTopic as Hex],
      }),
    { label: "getLogs" },
  ).then((logs) =>
    logs.filter((log) => {
      const t0 = log.topics[0]?.toLowerCase();
      return t0 === input.swapTopic.toLowerCase();
    }),
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
