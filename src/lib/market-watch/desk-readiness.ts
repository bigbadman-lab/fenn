/**
 * Pure readiness / projection helpers for Market Watch Desk (testable, no I/O).
 */

import type { MarketWatchMode } from "@/lib/market-watch/types";
import type {
  MarketWatchDeskProjection,
  MarketWatchReadinessVerdict,
} from "@/lib/market-watch/desk-types";

export const MARKET_WATCH_HEARTBEAT_STALE_SECONDS = 90;
/** Lag beyond confirmation depth + this many blocks ⇒ processing lag. */
export const MARKET_WATCH_PROCESSING_LAG_SLACK = 20;

export function mapMarketWatchErrorPlain(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  switch (code) {
    case "mw_not_configured":
    case "enabled_false":
    case "mw_config_disabled":
      return "THE OFFICIAL POOL IS NOT CONFIGURED OR NOT ENABLED.";
    case "mw_config_invalid":
    case "token_address_mismatch_official":
      return "THE CONFIGURED TOKEN DOES NOT MATCH THE OFFICIAL $FENN RECORD.";
    case "pool_token_mismatch":
    case "pool_token_order_read_failed":
      return "THE POOL DOES NOT CONTAIN THE EXPECTED TOKEN PAIR.";
    case "mw_rpc_unavailable":
    case "mw_rpc_failed":
      return "ROBINHOOD CHAIN COULD NOT BE READ.";
    case "mw_cursor_reorg":
      return "THE CURSOR BLOCK HASH NO LONGER MATCHES. INGESTION HAS STOPPED SAFELY.";
    case "mw_disabled":
      return "WORKER MODE IS DISABLED. NO CHAIN INSPECTION.";
    case "mw_lease_busy":
    case "busy":
      return "ANOTHER WORKER HOLDS THE LEASE.";
    case "mw_health_missing":
    case "mw_health_read_failed":
    case "mw_health_unavailable":
      return "WORKER HEALTH STATE COULD NOT BE READ.";
    default:
      if (code.startsWith("mw_config_")) {
        return "MARKET WATCH CONFIGURATION IS INCOMPLETE OR INVALID.";
      }
      return "THE WATCHER REPORTED AN OPERATIONAL ERROR.";
  }
}

export function deriveClearingProjection(input: {
  workerMode: MarketWatchMode;
  configEnabled: boolean;
}): MarketWatchDeskProjection {
  if (input.workerMode === "disabled") {
    return {
      status: "off_disabled",
      line: "CLEARING PROJECTION — OFF — WORKER DISABLED",
    };
  }
  if (input.workerMode === "dry_run") {
    return {
      status: "off_dry_run",
      line: "CLEARING PROJECTION — OFF — DRY RUN NEVER PUBLISHES",
    };
  }
  if (!input.configEnabled) {
    return {
      status: "off_config",
      line: "CLEARING PROJECTION — OFF — CONFIG NOT ENABLED",
    };
  }
  return {
    status: "on",
    line: "CLEARING PROJECTION — ON — PUBLISHED ACQUISITIONS MAY APPEAR",
  };
}

export function deriveEffectiveModeLine(input: {
  workerMode: MarketWatchMode;
  configEnabled: boolean;
}): string {
  if (input.workerMode === "disabled") {
    return "No chain ingestion. No events can be published.";
  }
  if (input.workerMode === "dry_run") {
    return "Events may be classified, but not published.";
  }
  if (!input.configEnabled) {
    return "Live mode is set, but config is disabled — nothing is published.";
  }
  return "Confirmed acquisitions may enter The Clearing.";
}

export function deriveReadinessVerdict(input: {
  configComplete: boolean;
  workerMode: MarketWatchMode;
  configEnabled: boolean;
  heartbeatStatus: "current" | "stale" | "absent";
  lastErrorCode: string | null;
  cursorLagBlocks: number | null;
  confirmationDepth: number | null;
  cursorExists: boolean;
  lastProcessedBlock: number | null;
}): MarketWatchReadinessVerdict {
  if (!input.configComplete) {
    return "not_configured";
  }

  const reorg = input.lastErrorCode === "mw_cursor_reorg";
  if (reorg) return "stalled";

  if (input.workerMode === "disabled") {
    return "disabled";
  }

  // Active modes need a living heartbeat when we expect work.
  if (input.heartbeatStatus === "stale" || input.heartbeatStatus === "absent") {
    return "stalled";
  }

  const conf = input.confirmationDepth ?? 5;
  const lag = input.cursorLagBlocks;
  if (
    lag != null &&
    lag > conf + MARKET_WATCH_PROCESSING_LAG_SLACK
  ) {
    return "degraded";
  }

  if (
    input.lastErrorCode &&
    input.lastErrorCode !== "mw_caught_up" &&
    input.lastErrorCode !== "mw_pre_launch" &&
    input.lastErrorCode !== "mw_config_disabled"
  ) {
    // Recent soft/hard error while still ticking → degraded unless reorg (above).
    if (
      input.lastErrorCode.startsWith("mw_") ||
      input.lastErrorCode.startsWith("official_token")
    ) {
      return "degraded";
    }
  }

  if (input.workerMode === "live") {
    if (!input.configEnabled) return "degraded";
    return "live";
  }

  return "dry_run";
}

export function readinessLabel(verdict: MarketWatchReadinessVerdict): string {
  switch (verdict) {
    case "not_configured":
      return "NOT CONFIGURED";
    case "disabled":
      return "DISABLED";
    case "dry_run":
      return "DRY RUN";
    case "live":
      return "LIVE";
    case "degraded":
      return "DEGRADED";
    case "stalled":
      return "STALLED";
  }
}

export function deriveCursorState(input: {
  cursorExists: boolean;
  launchBlock: number | null;
  lastProcessed: number | null;
  latestChain: number | null;
  confirmationDepth: number | null;
  lag: number | null;
  stalled: boolean;
}): MarketWatchDeskCursorState {
  if (input.stalled) {
    return {
      state: "stalled",
      stateLine: "THE WATCHER IS NOT ADVANCING.",
    };
  }
  if (!input.cursorExists) {
    if (
      input.launchBlock != null &&
      input.latestChain != null &&
      input.latestChain < input.launchBlock
    ) {
      return {
        state: "pre_launch",
        stateLine: "Chain head is still before launch block.",
      };
    }
    return {
      state: "not_initialised",
      stateLine: "CURSOR — NOT INITIALISED",
    };
  }
  const conf = input.confirmationDepth ?? 5;
  const lag = input.lag;
  if (lag == null) {
    return { state: "unknown", stateLine: "Cursor lag unavailable." };
  }
  if (lag <= conf) {
    return {
      state: "confirming",
      stateLine: `${lag} BLOCKS BEHIND CONFIRMATION HEAD (EXPECTED)`,
    };
  }
  if (lag <= conf + MARKET_WATCH_PROCESSING_LAG_SLACK) {
    return {
      state: "caught_up",
      stateLine: `${lag} BLOCKS BEHIND TIP`,
    };
  }
  return {
    state: "processing_lag",
    stateLine: `${lag} BLOCKS BEHIND — PROCESSING LAG`,
  };
}

type MarketWatchDeskCursorState = {
  state:
    | "not_initialised"
    | "pre_launch"
    | "caught_up"
    | "confirming"
    | "processing_lag"
    | "stalled"
    | "unknown";
  stateLine: string;
};

export function formatBlockNumber(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    const s = String(value);
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  return Math.trunc(n).toLocaleString("en-US");
}

export function shortHash(hash: string | null | undefined): string | null {
  if (!hash || hash.length < 12) return hash ?? null;
  const h = hash.toLowerCase();
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

export function shortLeaseHolder(holder: string | null | undefined): string | null {
  if (!holder) return null;
  // uuid:pid — keep first 8 of uuid
  const [uuid, pid] = holder.split(":");
  if (uuid && uuid.length >= 8) {
    return `${uuid.slice(0, 8)}…${pid ? `:${pid}` : ""}`;
  }
  return holder.slice(0, 16) + (holder.length > 16 ? "…" : "");
}
