/**
 * Single Market Watch ingestion tick (or disabled health pulse).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveOfficialMarketWatchConfig,
  type ResolvedMarketWatchConfig,
} from "@/lib/market-watch/config-loader";
import type { MarketWatchRuntimeConfig } from "@/lib/market-watch/config";
import { readMarketWatchCursor } from "@/lib/market-watch/cursor";
import { MarketWatchError } from "@/lib/market-watch/errors";
import { patchMarketWatchWorkerState } from "@/lib/market-watch/health";
import { logMarketWatch } from "@/lib/market-watch/log";
import { processConfirmedRange } from "@/lib/market-watch/process-range";
import {
  createMarketWatchRpcClient,
  getConfirmedHead,
  readBlockMeta,
  type MarketWatchRpcClient,
  withRpcRetry,
} from "@/lib/market-watch/rpc";
import { POOL_TOKEN_ORDER_ABI } from "@/lib/market-watch/topics";
import { createRobinhoodPublicClient } from "@/lib/treasury/chain";

export type TickResult = {
  ok: boolean;
  mode: string;
  code?: string;
  processed?: {
    fromBlock: string;
    toBlock: string;
    logsFetched: number;
    acquisitions: number;
    disposals: number;
    suppressed: number;
    duplicates: number;
  };
};

export type TickDeps = {
  admin?: SupabaseClient;
  rpc?: MarketWatchRpcClient;
  config?: ResolvedMarketWatchConfig;
  /** For tests: inject ready config without DB. */
  skipConfigLoad?: boolean;
  log?: typeof logMarketWatch;
  leaseHolder?: string | null;
};

/**
 * Detect cursor block-hash mismatch (reorg foundation). Fail closed.
 */
export async function assertCursorHashStillValid(input: {
  rpc: MarketWatchRpcClient;
  lastSafeBlock: bigint;
  lastSafeBlockHash: string | null;
}): Promise<void> {
  if (!input.lastSafeBlockHash) return;
  const meta = await readBlockMeta(input.rpc, input.lastSafeBlock);
  if (!meta.hash) {
    throw new MarketWatchError(
      "mw_cursor_reorg",
      "Unable to verify cursor block hash",
      503,
    );
  }
  if (meta.hash.toLowerCase() !== input.lastSafeBlockHash.toLowerCase()) {
    throw new MarketWatchError(
      "mw_cursor_reorg",
      "Cursor block hash mismatch — possible reorg",
      503,
    );
  }
}

async function buildPoolClient() {
  const client = createRobinhoodPublicClient();
  return {
    readContract: async (args: {
      address: `0x${string}`;
      abi: typeof POOL_TOKEN_ORDER_ABI;
      functionName: "token0" | "token1";
    }) =>
      client.readContract({
        address: args.address,
        abi: args.abi,
        functionName: args.functionName,
      }) as Promise<string>,
  };
}

/**
 * One tick of the worker loop.
 */
export async function runMarketWatchTick(
  runtime: MarketWatchRuntimeConfig,
  deps: TickDeps = {},
): Promise<TickResult> {
  const log = deps.log ?? logMarketWatch;
  const nowIso = () => new Date().toISOString();

  log({ event: "tick_start", ok: true, mode: runtime.mode });

  if (runtime.mode === "disabled") {
    await patchMarketWatchWorkerState(
      {
        mode: "disabled",
        configured: false,
        lastTickAt: nowIso(),
        lastSuccessAt: nowIso(),
        lastErrorCode: null,
        workerVersion: runtime.workerVersion,
        leaseHolder: deps.leaseHolder ?? null,
      },
      deps.admin,
    );
    log({ event: "mode_disabled", ok: true, mode: "disabled" });
    log({ event: "tick_end", ok: true, mode: "disabled" });
    return { ok: true, mode: "disabled", code: "mw_disabled" };
  }

  // dry_run / live
  try {
    let config = deps.config;
    if (!config) {
      const poolClient = await buildPoolClient();
      const state = await resolveOfficialMarketWatchConfig({
        admin: deps.admin,
        poolClient,
      });
      if (state.status !== "ready") {
        await patchMarketWatchWorkerState(
          {
            mode: runtime.mode,
            configured: false,
            lastTickAt: nowIso(),
            lastErrorAt: nowIso(),
            lastErrorCode:
              state.status === "missing"
                ? "mw_not_configured"
                : `mw_config_${state.reason}`,
            workerVersion: runtime.workerVersion,
            leaseHolder: deps.leaseHolder ?? null,
          },
          deps.admin,
        );
        log({
          event: "config_invalid",
          ok: false,
          code: state.status,
          mode: runtime.mode,
          detail:
            state.status === "missing" ? "missing" : state.reason,
        });
        return {
          ok: false,
          mode: runtime.mode,
          code: "mw_not_configured",
        };
      }
      if (!state.config.enabled) {
        await patchMarketWatchWorkerState(
          {
            mode: runtime.mode,
            configured: false,
            lastTickAt: nowIso(),
            lastSuccessAt: nowIso(),
            lastErrorCode: "mw_config_disabled",
            workerVersion: runtime.workerVersion,
            leaseHolder: deps.leaseHolder ?? null,
          },
          deps.admin,
        );
        log({
          event: "config_invalid",
          ok: true,
          code: "enabled_false",
          mode: runtime.mode,
        });
        return {
          ok: true,
          mode: runtime.mode,
          code: "mw_config_disabled",
        };
      }
      config = state.config;
    }

    log({ event: "config_valid", ok: true, mode: runtime.mode });

    const rpc =
      deps.rpc ??
      createMarketWatchRpcClient(process.env.ROBINHOOD_CHAIN_RPC_URL);

    // Ensure RPC reachable.
    await withRpcRetry(() => rpc.getBlockNumber(), { label: "tick_head" });

    const cursor = await readMarketWatchCursor(
      config.sourceKey,
      deps.admin,
    );

    if (cursor) {
      await assertCursorHashStillValid({
        rpc,
        lastSafeBlock: cursor.lastSafeBlock,
        lastSafeBlockHash: cursor.lastSafeBlockHash,
      });
    }

    const { latest, confirmedHead } = await getConfirmedHead({
      rpc,
      confirmationDepth: config.confirmationDepth,
    });

    // No confirmed blocks yet past launch.
    if (confirmedHead < config.launchBlock) {
      await patchMarketWatchWorkerState(
        {
          mode: runtime.mode,
          configured: true,
          lastTickAt: nowIso(),
          lastSuccessAt: nowIso(),
          lastErrorCode: null,
          latestChainBlock: latest,
          lastProcessedBlock: cursor?.lastSafeBlock ?? null,
          cursorLagBlocks: 0,
          workerVersion: runtime.workerVersion,
          leaseHolder: deps.leaseHolder ?? null,
        },
        deps.admin,
      );
      log({ event: "tick_end", ok: true, mode: runtime.mode, detail: "pre_launch" });
      return { ok: true, mode: runtime.mode, code: "mw_pre_launch" };
    }

    const start =
      cursor != null
        ? cursor.lastSafeBlock + BigInt(1)
        : config.launchBlock;

    if (start > confirmedHead) {
      await patchMarketWatchWorkerState(
        {
          mode: runtime.mode,
          configured: true,
          lastTickAt: nowIso(),
          lastSuccessAt: nowIso(),
          lastErrorCode: null,
          latestChainBlock: latest,
          lastProcessedBlock: cursor?.lastSafeBlock ?? confirmedHead,
          cursorLagBlocks: 0,
          workerVersion: runtime.workerVersion,
          leaseHolder: deps.leaseHolder ?? null,
        },
        deps.admin,
      );
      log({ event: "tick_end", ok: true, mode: runtime.mode, detail: "caught_up" });
      return { ok: true, mode: runtime.mode, code: "mw_caught_up" };
    }

    const rangeSize = BigInt(runtime.maxBlockRange);
    const end =
      start + rangeSize - BigInt(1) > confirmedHead
        ? confirmedHead
        : start + rangeSize - BigInt(1);

    const result = await processConfirmedRange({
      mode: runtime.mode,
      config,
      rpc,
      fromBlock: start,
      toBlock: end,
      advanceCursor: true,
      deps: { admin: deps.admin, log },
    });

    const lag = latest - end;
    await patchMarketWatchWorkerState(
      {
        mode: runtime.mode,
        configured: true,
        lastTickAt: nowIso(),
        lastSuccessAt: nowIso(),
        lastErrorAt: null,
        lastErrorCode: null,
        latestChainBlock: latest,
        lastProcessedBlock: end,
        cursorLagBlocks: lag < BigInt(0) ? BigInt(0) : lag,
        eventsSeenDelta: result.logsFetched,
        acquisitionsDelta: result.acquisitions,
        disposalsDelta: result.disposals,
        suppressedDelta: result.suppressed,
        workerVersion: runtime.workerVersion,
        leaseHolder: deps.leaseHolder ?? null,
      },
      deps.admin,
    );

    log({
      event: "tick_end",
      ok: true,
      mode: runtime.mode,
      fromBlock: start.toString(),
      toBlock: end.toString(),
      acquisitions: result.acquisitions,
      disposals: result.disposals,
      suppressed: result.suppressed,
      duplicates: result.duplicates,
    });

    return {
      ok: true,
      mode: runtime.mode,
      processed: {
        fromBlock: start.toString(),
        toBlock: end.toString(),
        logsFetched: result.logsFetched,
        acquisitions: result.acquisitions,
        disposals: result.disposals,
        suppressed: result.suppressed,
        duplicates: result.duplicates,
      },
    };
  } catch (error) {
    const code =
      error instanceof MarketWatchError ? error.code : "mw_internal";
    log({
      event: code === "mw_cursor_reorg" ? "reorg_suspicion" : "database_error",
      ok: false,
      code,
      mode: runtime.mode,
      detail: error instanceof Error ? error.message : "error",
    });
    try {
      await patchMarketWatchWorkerState(
        {
          mode: runtime.mode,
          lastTickAt: nowIso(),
          lastErrorAt: nowIso(),
          lastErrorCode: code,
          workerVersion: runtime.workerVersion,
          leaseHolder: deps.leaseHolder ?? null,
        },
        deps.admin,
      );
    } catch {
      // best-effort health write
    }
    log({ event: "tick_end", ok: false, mode: runtime.mode, code });
    return { ok: false, mode: runtime.mode, code };
  }
}
