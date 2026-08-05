/**
 * Market Watch 1.0A — shared types (server domain; safe DTO subset for Desk).
 */

export const MARKET_WATCH_POOL_KINDS = [
  "uniswap_v2",
  "uniswap_v3",
  "custom",
] as const;

export type MarketWatchPoolKind = (typeof MARKET_WATCH_POOL_KINDS)[number];

export const MARKET_WATCH_EVENT_TYPES = ["acquisition", "disposal"] as const;
export type MarketWatchEventType = (typeof MARKET_WATCH_EVENT_TYPES)[number];

export const MARKET_WATCH_EVENT_STATUSES = [
  "observed",
  "published",
  "suppressed",
  "reorged",
] as const;
export type MarketWatchEventStatus =
  (typeof MARKET_WATCH_EVENT_STATUSES)[number];

export const MARKET_WATCH_MODES = ["disabled", "dry_run", "live"] as const;
export type MarketWatchMode = (typeof MARKET_WATCH_MODES)[number];

export type MarketWatchTokenOrder = {
  token0: string;
  token1: string;
  fennIsToken0: boolean;
  quoteIsToken0: boolean;
};

export type ClassifiedSwap = {
  eventType: MarketWatchEventType;
  fennAmountRaw: bigint;
  quoteAmountRaw: bigint;
  classificationVersion: string;
};

export type SuppressResult = {
  kind: "suppress";
  reason: string;
  eventType?: MarketWatchEventType;
  fennAmountRaw?: bigint;
  quoteAmountRaw?: bigint;
};

export type ClassifyResult =
  | ({ kind: "ok" } & ClassifiedSwap)
  | SuppressResult;

export type CanonicalSwapLog = {
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: bigint;
  blockHash: string | null;
  transactionHash: string;
  logIndex: number;
  transactionIndex?: number;
};

export type MarketWatchHealthSnapshot = {
  configured: boolean;
  mode: MarketWatchMode;
  running: boolean;
  leaseHolder: string | null;
  lastTickAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  latestChainBlock: number | null;
  lastProcessedBlock: number | null;
  cursorLagBlocks: number | null;
  eventsSeen: number;
  acquisitionsClassified: number;
  disposalsClassified: number;
  suppressedCount: number;
  workerVersion: string | null;
  checkedAt: string;
};

/** Desk-safe twin of worker health (no secrets). */
export type MarketWatchDeskHealth = MarketWatchHealthSnapshot;
