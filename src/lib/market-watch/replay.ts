/**
 * Manual bounded-range replay for Market Watch (CLI).
 * Default mode dry_run; live requires explicit --live-replay.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveMarketWatchRuntimeConfig,
  type MarketWatchRuntimeConfig,
} from "@/lib/market-watch/config";
import {
  resolveOfficialMarketWatchConfig,
  type ResolvedMarketWatchConfig,
} from "@/lib/market-watch/config-loader";
import { MarketWatchError } from "@/lib/market-watch/errors";
import { logMarketWatch } from "@/lib/market-watch/log";
import { processConfirmedRange } from "@/lib/market-watch/process-range";
import {
  createMarketWatchRpcClient,
  type MarketWatchRpcClient,
} from "@/lib/market-watch/rpc";
import { POOL_TOKEN_ORDER_ABI } from "@/lib/market-watch/topics";
import type { MarketWatchMode } from "@/lib/market-watch/types";
import { createRobinhoodPublicClient } from "@/lib/treasury/chain";

export type ReplayArgs = {
  fromBlock: bigint;
  toBlock: bigint;
  mode: MarketWatchMode;
  /** When true and mode live, allow live status decisions + no cursor advance default. */
  liveReplay: boolean;
  advanceCursor: boolean;
};

export function parseReplayArgs(argv: string[]): ReplayArgs {
  let fromBlock: bigint | null = null;
  let toBlock: bigint | null = null;
  let mode: MarketWatchMode = "dry_run";
  let liveReplay = false;
  let advanceCursor = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from-block" && argv[i + 1]) {
      fromBlock = BigInt(argv[++i]);
    } else if (a === "--to-block" && argv[i + 1]) {
      toBlock = BigInt(argv[++i]);
    } else if (a === "--mode" && argv[i + 1]) {
      const m = argv[++i].trim().toLowerCase();
      if (m === "live" || m === "dry_run" || m === "disabled") {
        mode = m;
      }
    } else if (a === "--live-replay") {
      liveReplay = true;
    } else if (a === "--advance-cursor") {
      advanceCursor = true;
    }
  }

  if (fromBlock === null || toBlock === null) {
    throw new MarketWatchError(
      "mw_range_invalid",
      "Replay requires --from-block and --to-block",
      400,
    );
  }
  if (fromBlock > toBlock) {
    throw new MarketWatchError(
      "mw_range_invalid",
      "from-block must be <= to-block",
      400,
    );
  }
  const span = toBlock - fromBlock + BigInt(1);
  if (span > BigInt(5000)) {
    throw new MarketWatchError(
      "mw_range_invalid",
      "Replay range too large (max 5000 blocks)",
      400,
    );
  }
  if (mode === "live" && !liveReplay) {
    throw new MarketWatchError(
      "mw_config_invalid",
      "Live replay requires --live-replay",
      400,
    );
  }
  if (mode === "disabled") {
    throw new MarketWatchError(
      "mw_disabled",
      "Cannot replay in disabled mode",
      400,
    );
  }

  return { fromBlock, toBlock, mode, liveReplay, advanceCursor };
}

export type ReplayDeps = {
  admin?: SupabaseClient;
  rpc?: MarketWatchRpcClient;
  config?: ResolvedMarketWatchConfig;
  runtime?: MarketWatchRuntimeConfig;
  log?: typeof logMarketWatch;
};

export async function runMarketWatchReplay(
  args: ReplayArgs,
  deps: ReplayDeps = {},
) {
  const log = deps.log ?? logMarketWatch;
  const runtime = deps.runtime ?? resolveMarketWatchRuntimeConfig();

  let config = deps.config;
  if (!config) {
    const client = createRobinhoodPublicClient();
    const poolClient = {
      readContract: async (cargs: {
        address: `0x${string}`;
        abi: typeof POOL_TOKEN_ORDER_ABI;
        functionName: "token0" | "token1";
      }) =>
        client.readContract({
          address: cargs.address,
          abi: cargs.abi,
          functionName: cargs.functionName,
        }) as Promise<string>,
    };
    const state = await resolveOfficialMarketWatchConfig({
      admin: deps.admin,
      poolClient,
    });
    if (state.status !== "ready" || !state.config.enabled) {
      throw new MarketWatchError(
        "mw_not_configured",
        "Official Market Watch config is missing or disabled",
        503,
      );
    }
    config = state.config;
  }

  const rpc =
    deps.rpc ??
    createMarketWatchRpcClient(process.env.ROBINHOOD_CHAIN_RPC_URL);

  const result = await processConfirmedRange({
    mode: args.mode,
    config,
    rpc,
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
    advanceCursor: args.advanceCursor,
    deps: { admin: deps.admin, log },
  });

  log({
    event: "replay_summary",
    ok: true,
    mode: args.mode,
    fromBlock: args.fromBlock.toString(),
    toBlock: args.toBlock.toString(),
    logCount: result.logsFetched,
    acquisitions: result.acquisitions,
    disposals: result.disposals,
    suppressed: result.suppressed,
    duplicates: result.duplicates,
  });

  return result;
}
