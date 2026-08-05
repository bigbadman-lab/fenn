/**
 * Desk-safe Market Watch DTOs (client-importable).
 * No RPC URLs, secrets, buyer identity, raw logs, or service-role fields.
 */

import type { MarketWatchMode } from "@/lib/market-watch/types";

export const MARKET_WATCH_DESK_POLL_MS = 12_000;
export const MARKET_WATCH_DESK_EVENT_PAGE = 25;

export type MarketWatchReadinessVerdict =
  | "not_configured"
  | "disabled"
  | "dry_run"
  | "live"
  | "degraded"
  | "stalled";

export type MarketWatchDeskEventFilter =
  | "all"
  | "acquisitions"
  | "disposals"
  | "published"
  | "suppressed"
  | "reorged"
  | "observed";

export type MarketWatchDeskConfigField =
  | "token_address"
  | "token_decimals"
  | "pool_address"
  | "pool_kind"
  | "quote_token_address"
  | "quote_token_decimals"
  | "launch_block";

export type MarketWatchDeskConfigSummary = {
  complete: boolean;
  enabled: boolean;
  chainId: number;
  tokenSymbol: string | null;
  tokenAddressShort: string | null;
  tokenAddressFull: string | null;
  tokenExplorerUrl: string | null;
  poolAddressShort: string | null;
  poolAddressFull: string | null;
  poolExplorerUrl: string | null;
  poolKind: string | null;
  quoteTokenSymbol: string | null;
  quoteTokenAddressShort: string | null;
  quoteTokenAddressFull: string | null;
  quoteExplorerUrl: string | null;
  launchBlock: string | null;
  confirmationDepth: number | null;
  minDisplayFennLabel: string | null;
  classificationVersion: string | null;
  missingFields: MarketWatchDeskConfigField[];
  validationNote: string | null;
};

export type MarketWatchDeskRuntime = {
  /** Effective env/runtime mode (authoritative for worker process). */
  workerMode: MarketWatchMode;
  configEnabled: boolean;
  effectiveLine: string;
  modeSource: "environment";
  modeGuidance: string;
};

export type MarketWatchDeskHeartbeat = {
  status: "current" | "stale" | "absent";
  lastTickAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorPlain: string | null;
  workerVersion: string | null;
  leaseHeld: boolean;
  leaseHolderLabel: string | null;
  running: boolean;
  staleAfterSeconds: number;
  ageSeconds: number | null;
};

export type MarketWatchDeskCursor = {
  exists: boolean;
  sourceKey: string | null;
  lastSafeBlock: string | null;
  lastSafeBlockHashShort: string | null;
  latestChainBlock: string | null;
  lastProcessedBlock: string | null;
  cursorLagBlocks: number | null;
  confirmationDepth: number | null;
  launchBlock: string | null;
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

export type MarketWatchDeskCounts = {
  eventsSeen: number;
  acquisitionsClassified: number;
  disposalsClassified: number;
  suppressed: number;
  published: number;
};

export type MarketWatchDeskEvent = {
  id: string;
  eventType: "acquisition" | "disposal";
  status: "observed" | "published" | "suppressed" | "reorged";
  fennAmountLabel: string;
  quoteAmountLabel: string | null;
  blockNumber: string;
  blockTimestamp: string | null;
  transactionHash: string;
  transactionHashShort: string;
  transactionUrl: string | null;
  logIndex: number;
  suppressReason: string | null;
  classificationVersion: string;
  observedAt: string;
  publishedAt: string | null;
  poolAddressShort: string | null;
  tokenAddressShort: string | null;
};

export type MarketWatchDeskProjection = {
  status: "off_disabled" | "off_dry_run" | "off_config" | "on";
  line: string;
};

export type MarketWatchDeskDryRun = {
  classifiedAny: boolean;
  recentClassifiedAt: string | null;
  lastAcquisitionAt: string | null;
  lastDisposalAt: string | null;
  lastSuppressedAt: string | null;
  guidance: string;
};

export type MarketWatchDeskWarning = {
  code: string;
  message: string;
};

export type MarketWatchDeskSnapshot = {
  verdict: MarketWatchReadinessVerdict;
  verdictLabel: string;
  config: MarketWatchDeskConfigSummary;
  runtime: MarketWatchDeskRuntime;
  heartbeat: MarketWatchDeskHeartbeat;
  cursor: MarketWatchDeskCursor;
  counts: MarketWatchDeskCounts;
  dryRun: MarketWatchDeskDryRun;
  projection: MarketWatchDeskProjection;
  warnings: MarketWatchDeskWarning[];
  events: MarketWatchDeskEvent[];
  nextCursor: string | null;
  liveActivationFromDesk: false;
  liveActivationNote: string;
  checkedAt: string;
};
