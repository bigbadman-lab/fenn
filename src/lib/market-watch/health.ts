/**
 * Market Watch worker health read/write (singleton row).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { MarketWatchMode } from "@/lib/market-watch/types";
import type { MarketWatchHealthSnapshot } from "@/lib/market-watch/types";
import {
  MARKET_WATCH_WORKER_VERSION,
  parseMarketWatchMode,
  resolveMarketWatchRuntimeConfig,
} from "@/lib/market-watch/config";

type WorkerStateRow = {
  mode: string;
  configured: boolean;
  last_tick_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
  latest_chain_block: number | string | null;
  last_processed_block: number | string | null;
  cursor_lag_blocks: number | string | null;
  events_seen: number | string;
  acquisitions_classified: number | string;
  disposals_classified: number | string;
  suppressed_count: number | string;
  worker_version: string | null;
  lease_holder: string | null;
};

function asNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export type WorkerStatePatch = {
  mode?: MarketWatchMode;
  configured?: boolean;
  lastTickAt?: string | null;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorCode?: string | null;
  latestChainBlock?: bigint | number | null;
  lastProcessedBlock?: bigint | number | null;
  cursorLagBlocks?: bigint | number | null;
  eventsSeenDelta?: number;
  acquisitionsDelta?: number;
  disposalsDelta?: number;
  suppressedDelta?: number;
  workerVersion?: string;
  leaseHolder?: string | null;
};

export async function patchMarketWatchWorkerState(
  patch: WorkerStatePatch,
  admin?: SupabaseClient,
): Promise<void> {
  const client = admin ?? (await defaultAdmin());
  const { data: existing } = await client
    .from("market_watch_worker_state")
    .select(
      "events_seen, acquisitions_classified, disposals_classified, suppressed_count",
    )
    .eq("id", 1)
    .maybeSingle();

  const base = (existing ?? {
    events_seen: 0,
    acquisitions_classified: 0,
    disposals_classified: 0,
    suppressed_count: 0,
  }) as {
    events_seen: number | string;
    acquisitions_classified: number | string;
    disposals_classified: number | string;
    suppressed_count: number | string;
  };

  const next = {
    id: 1,
    mode: patch.mode,
    configured: patch.configured,
    last_tick_at: patch.lastTickAt,
    last_success_at: patch.lastSuccessAt,
    last_error_at: patch.lastErrorAt,
    last_error_code: patch.lastErrorCode,
    latest_chain_block:
      patch.latestChainBlock === undefined
        ? undefined
        : patch.latestChainBlock === null
          ? null
          : patch.latestChainBlock.toString(),
    last_processed_block:
      patch.lastProcessedBlock === undefined
        ? undefined
        : patch.lastProcessedBlock === null
          ? null
          : patch.lastProcessedBlock.toString(),
    cursor_lag_blocks:
      patch.cursorLagBlocks === undefined
        ? undefined
        : patch.cursorLagBlocks === null
          ? null
          : patch.cursorLagBlocks.toString(),
    events_seen:
      patch.eventsSeenDelta !== undefined
        ? Number(base.events_seen) + patch.eventsSeenDelta
        : undefined,
    acquisitions_classified:
      patch.acquisitionsDelta !== undefined
        ? Number(base.acquisitions_classified) + patch.acquisitionsDelta
        : undefined,
    disposals_classified:
      patch.disposalsDelta !== undefined
        ? Number(base.disposals_classified) + patch.disposalsDelta
        : undefined,
    suppressed_count:
      patch.suppressedDelta !== undefined
        ? Number(base.suppressed_count) + patch.suppressedDelta
        : undefined,
    worker_version: patch.workerVersion,
    lease_holder: patch.leaseHolder,
    updated_at: new Date().toISOString(),
  };

  // Drop undefined keys so we do not null unintentionally.
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined) payload[k] = v;
  }

  await client.from("market_watch_worker_state").upsert(payload, {
    onConflict: "id",
  });
}

/**
 * Desk/ops health snapshot — honest booleans; no secrets.
 */
export async function getMarketWatchHealth(
  admin?: SupabaseClient,
): Promise<MarketWatchHealthSnapshot> {
  const checkedAt = new Date().toISOString();
  const runtime = resolveMarketWatchRuntimeConfig();
  try {
    const client = admin ?? (await defaultAdmin());
    const { data, error } = await client
      .from("market_watch_worker_state")
      .select(
        "mode, configured, last_tick_at, last_success_at, last_error_at, last_error_code, latest_chain_block, last_processed_block, cursor_lag_blocks, events_seen, acquisitions_classified, disposals_classified, suppressed_count, worker_version, lease_holder",
      )
      .eq("id", 1)
      .maybeSingle();

    if (error || !data) {
      return {
        configured: false,
        mode: runtime.mode,
        running: false,
        leaseHolder: null,
        lastTickAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorCode: error ? "mw_health_read_failed" : "mw_health_missing",
        latestChainBlock: null,
        lastProcessedBlock: null,
        cursorLagBlocks: null,
        eventsSeen: 0,
        acquisitionsClassified: 0,
        disposalsClassified: 0,
        suppressedCount: 0,
        workerVersion: MARKET_WATCH_WORKER_VERSION,
        checkedAt,
      };
    }

    const row = data as WorkerStateRow;
    const lastTickAt = row.last_tick_at;
    const running =
      lastTickAt != null &&
      Date.now() - Date.parse(lastTickAt) <
        (runtime.pollSeconds + 30) * 1000;

    return {
      configured: row.configured,
      mode: parseMarketWatchMode(row.mode),
      running,
      leaseHolder: row.lease_holder,
      lastTickAt: row.last_tick_at,
      lastSuccessAt: row.last_success_at,
      lastErrorAt: row.last_error_at,
      lastErrorCode: row.last_error_code,
      latestChainBlock: asNumber(row.latest_chain_block),
      lastProcessedBlock: asNumber(row.last_processed_block),
      cursorLagBlocks: asNumber(row.cursor_lag_blocks),
      eventsSeen: asNumber(row.events_seen) ?? 0,
      acquisitionsClassified: asNumber(row.acquisitions_classified) ?? 0,
      disposalsClassified: asNumber(row.disposals_classified) ?? 0,
      suppressedCount: asNumber(row.suppressed_count) ?? 0,
      workerVersion: row.worker_version ?? MARKET_WATCH_WORKER_VERSION,
      checkedAt,
    };
  } catch {
    return {
      configured: false,
      mode: runtime.mode,
      running: false,
      leaseHolder: null,
      lastTickAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorCode: "mw_health_unavailable",
      latestChainBlock: null,
      lastProcessedBlock: null,
      cursorLagBlocks: null,
      eventsSeen: 0,
      acquisitionsClassified: 0,
      disposalsClassified: 0,
      suppressedCount: 0,
      workerVersion: MARKET_WATCH_WORKER_VERSION,
      checkedAt,
    };
  }
}
