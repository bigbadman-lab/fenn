/**
 * Server-only Market Watch Desk snapshot (config, health, events).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatClearingMarketFennAmount,
  marketWatchExplorerUrl,
} from "@/lib/clearing/market-display";
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/clearing/dto";
import {
  resolveMarketWatchRuntimeConfig,
  MARKET_WATCH_CHAIN_ID,
} from "@/lib/market-watch/config";
import {
  loadMarketWatchConfigRow,
  type MarketWatchConfigRow,
} from "@/lib/market-watch/config-loader";
import { getMarketWatchHealth } from "@/lib/market-watch/health";
import {
  deriveClearingProjection,
  deriveCursorState,
  deriveEffectiveModeLine,
  deriveReadinessVerdict,
  formatBlockNumber,
  mapMarketWatchErrorPlain,
  MARKET_WATCH_HEARTBEAT_STALE_SECONDS,
  readinessLabel,
  shortHash,
  shortLeaseHolder,
} from "@/lib/market-watch/desk-readiness";
import type {
  MarketWatchDeskConfigField,
  MarketWatchDeskConfigSummary,
  MarketWatchDeskEvent,
  MarketWatchDeskEventFilter,
  MarketWatchDeskSnapshot,
} from "@/lib/market-watch/desk-types";
import {
  MARKET_WATCH_DESK_EVENT_PAGE,
} from "@/lib/market-watch/desk-types";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { explorerAddressUrl } from "@/lib/greenwood/hollow/explorer";
import { abbreviateEvmAddress } from "@/lib/wallet/evm";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function parseEventFilter(
  raw: string | null | undefined,
): MarketWatchDeskEventFilter {
  switch (raw) {
    case "acquisitions":
    case "disposals":
    case "published":
    case "suppressed":
    case "reorged":
    case "observed":
      return raw;
    default:
      return "all";
  }
}

function missingConfigFields(
  row: MarketWatchConfigRow | null,
): MarketWatchDeskConfigField[] {
  if (!row) {
    return [
      "token_address",
      "token_decimals",
      "pool_address",
      "pool_kind",
      "quote_token_address",
      "quote_token_decimals",
      "launch_block",
    ];
  }
  const missing: MarketWatchDeskConfigField[] = [];
  if (!row.token_address) missing.push("token_address");
  if (row.token_decimals == null) missing.push("token_decimals");
  if (!row.pool_address) missing.push("pool_address");
  if (!row.pool_kind) missing.push("pool_kind");
  if (!row.quote_token_address) missing.push("quote_token_address");
  if (row.quote_token_decimals == null) missing.push("quote_token_decimals");
  if (row.launch_block == null || String(row.launch_block) === "") {
    missing.push("launch_block");
  }
  return missing;
}

function toConfigSummary(row: MarketWatchConfigRow | null): MarketWatchDeskConfigSummary {
  const missing = missingConfigFields(row);
  if (!row) {
    return {
      complete: false,
      enabled: false,
      chainId: MARKET_WATCH_CHAIN_ID,
      tokenSymbol: null,
      tokenAddressShort: null,
      tokenAddressFull: null,
      tokenExplorerUrl: null,
      poolAddressShort: null,
      poolAddressFull: null,
      poolExplorerUrl: null,
      poolKind: null,
      quoteTokenSymbol: null,
      quoteTokenAddressShort: null,
      quoteTokenAddressFull: null,
      quoteExplorerUrl: null,
      launchBlock: null,
      confirmationDepth: null,
      minDisplayFennLabel: null,
      classificationVersion: null,
      missingFields: missing,
      validationNote: "No market_watch_config row.",
    };
  }

  const tokenFull = row.token_address?.toLowerCase() ?? null;
  const poolFull = row.pool_address?.toLowerCase() ?? null;
  const quoteFull = row.quote_token_address?.toLowerCase() ?? null;
  const decimals = row.token_decimals ?? 18;
  const minRaw = row.min_display_fenn_raw;

  return {
    complete: missing.length === 0,
    enabled: Boolean(row.enabled),
    chainId: row.chain_id || ROBINHOOD_CHAIN_ID,
    tokenSymbol: row.token_symbol,
    tokenAddressShort: tokenFull ? abbreviateEvmAddress(tokenFull) : null,
    tokenAddressFull: tokenFull,
    tokenExplorerUrl: tokenFull
      ? explorerAddressUrl(ROBINHOOD_CHAIN_ID, tokenFull)
      : null,
    poolAddressShort: poolFull ? abbreviateEvmAddress(poolFull) : null,
    poolAddressFull: poolFull,
    poolExplorerUrl: poolFull
      ? explorerAddressUrl(ROBINHOOD_CHAIN_ID, poolFull)
      : null,
    poolKind: row.pool_kind,
    quoteTokenSymbol: row.quote_token_symbol,
    quoteTokenAddressShort: quoteFull
      ? abbreviateEvmAddress(quoteFull)
      : null,
    quoteTokenAddressFull: quoteFull,
    quoteExplorerUrl: quoteFull
      ? explorerAddressUrl(ROBINHOOD_CHAIN_ID, quoteFull)
      : null,
    launchBlock:
      row.launch_block == null ? null : formatBlockNumber(row.launch_block),
    confirmationDepth: row.confirmation_depth,
    minDisplayFennLabel: formatClearingMarketFennAmount(
      String(minRaw ?? 0),
      decimals,
      row.token_symbol ?? "FENN",
    ),
    classificationVersion: row.classification_version,
    missingFields: missing,
    validationNote: missing.length
      ? `Missing: ${missing.map((f) => f.replace(/_/g, " ").toUpperCase()).join(", ")}`
      : null,
  };
}

async function publishedCount(admin: SupabaseClient): Promise<number> {
  try {
    const { count, error } = await admin
      .from("market_watch_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "published");
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function loadCursor(
  admin: SupabaseClient,
  poolAddress: string | null,
): Promise<{
  exists: boolean;
  sourceKey: string | null;
  lastSafeBlock: string | null;
  lastSafeBlockHash: string | null;
}> {
  try {
    let query = admin
      .from("market_watch_cursors")
      .select(
        "source_key, last_safe_block, last_safe_block_hash, pool_address",
      )
      .limit(1);
    if (poolAddress) {
      query = query.eq("pool_address", poolAddress.toLowerCase());
    }
    const { data, error } = await query;
    const row = !error && data && data.length > 0 ? data[0] : null;
    if (!row) {
      return {
        exists: false,
        sourceKey: null,
        lastSafeBlock: null,
        lastSafeBlockHash: null,
      };
    }
    return {
      exists: true,
      sourceKey: String(row.source_key),
      lastSafeBlock: String(row.last_safe_block),
      lastSafeBlockHash: row.last_safe_block_hash
        ? String(row.last_safe_block_hash)
        : null,
    };
  } catch {
    return {
      exists: false,
      sourceKey: null,
      lastSafeBlock: null,
      lastSafeBlockHash: null,
    };
  }
}

function toDeskEvent(
  row: Record<string, unknown>,
  tokenDecimals: number,
  quoteDecimals: number,
  tokenSymbol: string,
  quoteSymbol: string,
): MarketWatchDeskEvent | null {
  const id = String(row.id ?? "");
  if (!id) return null;
  const eventType =
    row.event_type === "disposal" ? "disposal" : "acquisition";
  const statusRaw = String(row.status ?? "observed");
  const status =
    statusRaw === "published" ||
    statusRaw === "suppressed" ||
    statusRaw === "reorged" ||
    statusRaw === "observed"
      ? statusRaw
      : "observed";
  const tx = String(row.transaction_hash ?? "").toLowerCase();
  const chainId = Number(row.chain_id) || ROBINHOOD_CHAIN_ID;
  const pool = row.pool_address
    ? String(row.pool_address).toLowerCase()
    : null;
  const token = row.token_address
    ? String(row.token_address).toLowerCase()
    : null;

  return {
    id,
    eventType,
    status,
    fennAmountLabel: formatClearingMarketFennAmount(
      String(row.fenn_amount_raw ?? 0),
      tokenDecimals,
      tokenSymbol,
    ),
    quoteAmountLabel: formatClearingMarketFennAmount(
      String(row.quote_amount_raw ?? 0),
      quoteDecimals,
      quoteSymbol,
    ),
    blockNumber: formatBlockNumber(row.block_number as string | number) ?? "—",
    blockTimestamp: row.block_timestamp
      ? String(row.block_timestamp)
      : null,
    transactionHash: tx,
    transactionHashShort: shortHash(tx) ?? tx,
    transactionUrl: marketWatchExplorerUrl(chainId, tx),
    logIndex: Number(row.log_index ?? 0),
    suppressReason: row.suppress_reason
      ? String(row.suppress_reason)
      : null,
    classificationVersion: String(row.classification_version ?? "—"),
    observedAt: String(row.observed_at ?? row.created_at ?? ""),
    publishedAt: row.published_at ? String(row.published_at) : null,
    poolAddressShort: pool ? abbreviateEvmAddress(pool) : null,
    tokenAddressShort: token ? abbreviateEvmAddress(token) : null,
  };
}

async function loadEvents(
  admin: SupabaseClient,
  filter: MarketWatchDeskEventFilter,
  cursor: { createdAt: string; id: string } | null,
  tokenDecimals: number,
  quoteDecimals: number,
  tokenSymbol: string,
  quoteSymbol: string,
): Promise<{ events: MarketWatchDeskEvent[]; nextCursor: string | null }> {
  try {
    let q = admin
      .from("market_watch_events")
      .select(
        "id, event_type, status, fenn_amount_raw, quote_amount_raw, block_number, block_timestamp, transaction_hash, log_index, suppress_reason, classification_version, observed_at, published_at, pool_address, token_address, chain_id, created_at",
      )
      .order("observed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MARKET_WATCH_DESK_EVENT_PAGE + 1);

    if (filter === "acquisitions") q = q.eq("event_type", "acquisition");
    if (filter === "disposals") q = q.eq("event_type", "disposal");
    if (filter === "published") q = q.eq("status", "published");
    if (filter === "suppressed") q = q.eq("status", "suppressed");
    if (filter === "reorged") q = q.eq("status", "reorged");
    if (filter === "observed") q = q.eq("status", "observed");

    if (cursor) {
      const observedAt = `"${cursor.createdAt.replace(/"/g, "")}"`;
      q = q.or(
        `observed_at.lt.${observedAt},and(observed_at.eq.${observedAt},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await q;
    if (error || !data) {
      return { events: [], nextCursor: null };
    }
    const page = data.slice(0, MARKET_WATCH_DESK_EVENT_PAGE);
    const events = page
      .map((row) =>
        toDeskEvent(
          row as Record<string, unknown>,
          tokenDecimals,
          quoteDecimals,
          tokenSymbol,
          quoteSymbol,
        ),
      )
      .filter((e): e is MarketWatchDeskEvent => e != null);
    const last = page[page.length - 1];
    const nextCursor =
      data.length > MARKET_WATCH_DESK_EVENT_PAGE && last
        ? encodeFeedCursor(String(last.observed_at), String(last.id))
        : null;
    return { events, nextCursor };
  } catch {
    return { events: [], nextCursor: null };
  }
}

async function dryRunMeta(admin: SupabaseClient): Promise<{
  classifiedAny: boolean;
  recentClassifiedAt: string | null;
  lastAcquisitionAt: string | null;
  lastDisposalAt: string | null;
  lastSuppressedAt: string | null;
}> {
  try {
    const [any, acq, disp, sup] = await Promise.all([
      admin
        .from("market_watch_events")
        .select("observed_at")
        .order("observed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("market_watch_events")
        .select("observed_at")
        .eq("event_type", "acquisition")
        .order("observed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("market_watch_events")
        .select("observed_at")
        .eq("event_type", "disposal")
        .order("observed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("market_watch_events")
        .select("observed_at")
        .eq("status", "suppressed")
        .order("observed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    return {
      classifiedAny: Boolean(any.data),
      recentClassifiedAt: any.data?.observed_at
        ? String(any.data.observed_at)
        : null,
      lastAcquisitionAt: acq.data?.observed_at
        ? String(acq.data.observed_at)
        : null,
      lastDisposalAt: disp.data?.observed_at
        ? String(disp.data.observed_at)
        : null,
      lastSuppressedAt: sup.data?.observed_at
        ? String(sup.data.observed_at)
        : null,
    };
  } catch {
    return {
      classifiedAny: false,
      recentClassifiedAt: null,
      lastAcquisitionAt: null,
      lastDisposalAt: null,
      lastSuppressedAt: null,
    };
  }
}

/**
 * Full Desk operator snapshot — fail soft on missing MW tables.
 */
export async function getMarketWatchDeskSnapshot(input: {
  filter?: string | null;
  cursor?: string | null;
  admin?: SupabaseClient;
} = {}): Promise<MarketWatchDeskSnapshot> {
  const admin = input.admin ?? (await defaultAdmin());
  const runtimeCfg = resolveMarketWatchRuntimeConfig();
  // Env is authoritative for worker process mode.
  const workerMode = runtimeCfg.mode;
  const filter = parseEventFilter(input.filter);
  const cursor = decodeFeedCursor(input.cursor);
  const checkedAt = new Date().toISOString();

  const [row, health] = await Promise.all([
    loadMarketWatchConfigRow(admin).catch(() => null),
    getMarketWatchHealth(admin),
  ]);

  const config = toConfigSummary(row);
  const tokenDecimals = row?.token_decimals ?? 18;
  const quoteDecimals = row?.quote_token_decimals ?? 18;
  const tokenSymbol = row?.token_symbol?.trim() || "FENN";
  const quoteSymbol = row?.quote_token_symbol?.trim() || "QUOTE";

  const [cursorRow, eventsPage, pubCount, dryMeta] = await Promise.all([
    loadCursor(admin, row?.pool_address ?? null),
    loadEvents(
      admin,
      filter,
      cursor,
      tokenDecimals,
      quoteDecimals,
      tokenSymbol,
      quoteSymbol,
    ),
    publishedCount(admin),
    dryRunMeta(admin),
  ]);

  const now = Date.now();
  const lastTickMs = health.lastTickAt
    ? Date.parse(health.lastTickAt)
    : NaN;
  const ageSeconds = Number.isFinite(lastTickMs)
    ? Math.max(0, Math.floor((now - lastTickMs) / 1000))
    : null;
  let heartbeatStatus: "current" | "stale" | "absent" = "absent";
  if (ageSeconds == null) heartbeatStatus = "absent";
  else if (ageSeconds <= MARKET_WATCH_HEARTBEAT_STALE_SECONDS) {
    heartbeatStatus = "current";
  } else {
    heartbeatStatus = "stale";
  }

  // Prefer env mode over DB mode for operator truth.
  const lag = health.cursorLagBlocks;
  const lastProcessed =
    health.lastProcessedBlock ??
    (cursorRow.lastSafeBlock != null
      ? Number(cursorRow.lastSafeBlock)
      : null);
  const latest = health.latestChainBlock;
  const confDepth =
    config.confirmationDepth ?? row?.confirmation_depth ?? 5;

  const reorg = health.lastErrorCode === "mw_cursor_reorg";
  const stalledHeart =
    workerMode !== "disabled" &&
    (heartbeatStatus === "stale" || heartbeatStatus === "absent");
  const cursorState = deriveCursorState({
    cursorExists: cursorRow.exists,
    launchBlock: row?.launch_block != null ? Number(row.launch_block) : null,
    lastProcessed: lastProcessed != null && Number.isFinite(lastProcessed) ? lastProcessed : null,
    latestChain: latest,
    confirmationDepth: confDepth,
    lag,
    stalled: reorg || stalledHeart,
  });

  const verdict = deriveReadinessVerdict({
    configComplete: config.complete,
    workerMode,
    configEnabled: config.enabled,
    heartbeatStatus,
    lastErrorCode: health.lastErrorCode,
    cursorLagBlocks: lag,
    confirmationDepth: confDepth,
    cursorExists: cursorRow.exists,
    lastProcessedBlock:
      lastProcessed != null && Number.isFinite(Number(lastProcessed))
        ? Number(lastProcessed)
        : null,
  });

  const warnings: MarketWatchDeskSnapshot["warnings"] = [];
  if (!config.complete) {
    warnings.push({
      code: "mw_not_configured",
      message: "THE OFFICIAL POOL IS NOT CONFIGURED.",
    });
  }
  if (config.validationNote && !config.complete) {
    warnings.push({
      code: "mw_config_incomplete",
      message: config.validationNote,
    });
  }
  if (health.lastErrorCode) {
    const plain = mapMarketWatchErrorPlain(health.lastErrorCode);
    if (plain) {
      warnings.push({
        code: health.lastErrorCode,
        message: plain,
      });
    }
  }
  if (stalledHeart) {
    warnings.push({
      code: "mw_heartbeat_stale",
      message: "THE WATCHER HEARTBEAT IS STALE OR ABSENT.",
    });
  }
  if (workerMode === "live" && !config.enabled) {
    warnings.push({
      code: "mw_live_config_disabled",
      message: "WORKER MODE IS LIVE BUT CONFIG ENABLED IS NO.",
    });
  }

  // Dedupe warnings by code
  const seenCodes = new Set<string>();
  const uniqueWarnings = warnings.filter((w) => {
    if (seenCodes.has(w.code)) return false;
    seenCodes.add(w.code);
    return true;
  });

  return {
    verdict,
    verdictLabel: readinessLabel(verdict),
    config,
    runtime: {
      workerMode,
      configEnabled: config.enabled,
      effectiveLine: deriveEffectiveModeLine({
        workerMode,
        configEnabled: config.enabled,
      }),
      modeSource: "environment",
      modeGuidance:
        "Mode is controlled by FENN_MARKET_WATCH_MODE on the Render worker (environment). There is no Desk toggle. See docs/market-watch.md.",
    },
    heartbeat: {
      status: heartbeatStatus,
      lastTickAt: health.lastTickAt,
      lastSuccessAt: health.lastSuccessAt,
      lastErrorAt: health.lastErrorAt,
      lastErrorCode: health.lastErrorCode,
      lastErrorPlain: mapMarketWatchErrorPlain(health.lastErrorCode),
      workerVersion: health.workerVersion,
      leaseHeld: Boolean(health.leaseHolder),
      leaseHolderLabel: shortLeaseHolder(health.leaseHolder),
      running: health.running,
      staleAfterSeconds: MARKET_WATCH_HEARTBEAT_STALE_SECONDS,
      ageSeconds,
    },
    cursor: {
      exists: cursorRow.exists,
      sourceKey: cursorRow.sourceKey,
      lastSafeBlock: formatBlockNumber(cursorRow.lastSafeBlock),
      lastSafeBlockHashShort: shortHash(cursorRow.lastSafeBlockHash),
      latestChainBlock: formatBlockNumber(latest),
      lastProcessedBlock: formatBlockNumber(
        lastProcessed ?? cursorRow.lastSafeBlock,
      ),
      cursorLagBlocks: lag,
      confirmationDepth: confDepth,
      launchBlock: config.launchBlock,
      state: cursorState.state,
      stateLine: cursorState.stateLine,
    },
    counts: {
      eventsSeen: health.eventsSeen,
      acquisitionsClassified: health.acquisitionsClassified,
      disposalsClassified: health.disposalsClassified,
      suppressed: health.suppressedCount,
      published: pubCount,
    },
    dryRun: {
      classifiedAny: dryMeta.classifiedAny,
      recentClassifiedAt: dryMeta.recentClassifiedAt,
      lastAcquisitionAt: dryMeta.lastAcquisitionAt,
      lastDisposalAt: dryMeta.lastDisposalAt,
      lastSuppressedAt: dryMeta.lastSuppressedAt,
      guidance:
        "VERIFY RECENT EVENTS AGAINST THE ROBINHOOD EXPLORER BEFORE LIVE MODE.",
    },
    projection: deriveClearingProjection({
      workerMode,
      configEnabled: config.enabled,
    }),
    warnings: uniqueWarnings,
    events: eventsPage.events,
    nextCursor: eventsPage.nextCursor,
    liveActivationFromDesk: false,
    liveActivationNote:
      "LIVE ACTIVATION IS NOT YET AVAILABLE FROM DESK. Change FENN_MARKET_WATCH_MODE on Render and set config.enabled in SQL after dry-run verification. See docs/market-watch.md and docs/market-watch-activation.sql.",
    checkedAt,
  };
}
