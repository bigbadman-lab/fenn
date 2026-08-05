/**
 * Market Watch runtime configuration from environment (modes, poll, lease).
 * Default mode is always disabled — never live.
 */

import type { MarketWatchMode } from "@/lib/market-watch/types";
import { MARKET_WATCH_MODES } from "@/lib/market-watch/types";
import { MARKET_WATCH_WORKER_VERSION } from "@/lib/market-watch/thresholds";

export const FENN_MARKET_WATCH_MODE_ENV = "FENN_MARKET_WATCH_MODE";
export const FENN_MARKET_WATCH_POLL_SECONDS_ENV =
  "FENN_MARKET_WATCH_POLL_SECONDS";
export const FENN_MARKET_WATCH_LEASE_KEY_ENV = "FENN_MARKET_WATCH_LEASE_KEY";
export const FENN_MARKET_WATCH_MAX_BLOCK_RANGE_ENV =
  "FENN_MARKET_WATCH_MAX_BLOCK_RANGE";
export const FENN_MARKET_WATCH_RPC_TIMEOUT_MS_ENV =
  "FENN_MARKET_WATCH_RPC_TIMEOUT_MS";

export const MARKET_WATCH_DEFAULT_MODE: MarketWatchMode = "disabled";
export const MARKET_WATCH_DEFAULT_LEASE_KEY = "market_watch";
export const MARKET_WATCH_DEFAULT_POLL_SECONDS = 10;
export const MARKET_WATCH_MIN_POLL_SECONDS = 8;
export const MARKET_WATCH_MAX_POLL_SECONDS = 15;
export const MARKET_WATCH_DEFAULT_MAX_BLOCK_RANGE = 500;
export const MARKET_WATCH_MIN_BLOCK_RANGE = 1;
export const MARKET_WATCH_MAX_BLOCK_RANGE_CAP = 2000;
export const MARKET_WATCH_DEFAULT_RPC_TIMEOUT_MS = 20_000;
export const MARKET_WATCH_LEASE_TTL_PADDING_SECONDS = 45;
export { MARKET_WATCH_WORKER_VERSION };
export const MARKET_WATCH_CLASSIFICATION_VERSION = "mw_v1";
export const MARKET_WATCH_SOURCE_KEY_PREFIX = "official_pool";
export const MARKET_WATCH_CHAIN_ID = 4663;

export type MarketWatchRuntimeConfig = {
  mode: MarketWatchMode;
  pollSeconds: number;
  leaseKey: string;
  leaseTtlSeconds: number;
  maxBlockRange: number;
  rpcTimeoutMs: number;
  workerVersion: string;
};

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(n, max);
}

/**
 * Resolve execution mode. Missing/blank/invalid → disabled (never live).
 */
export function parseMarketWatchMode(
  raw: string | undefined,
): MarketWatchMode {
  if (raw === undefined) return "disabled";
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return "disabled";
  if ((MARKET_WATCH_MODES as readonly string[]).includes(trimmed)) {
    return trimmed as MarketWatchMode;
  }
  return "disabled";
}

export function resolveMarketWatchRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): MarketWatchRuntimeConfig {
  const mode = parseMarketWatchMode(env[FENN_MARKET_WATCH_MODE_ENV]);
  const pollSeconds = parsePositiveInt(
    env[FENN_MARKET_WATCH_POLL_SECONDS_ENV],
    MARKET_WATCH_DEFAULT_POLL_SECONDS,
    MARKET_WATCH_MIN_POLL_SECONDS,
    MARKET_WATCH_MAX_POLL_SECONDS,
  );
  const leaseKeyRaw = env[FENN_MARKET_WATCH_LEASE_KEY_ENV]?.trim();
  const leaseKey =
    leaseKeyRaw && leaseKeyRaw.length > 0
      ? leaseKeyRaw
      : MARKET_WATCH_DEFAULT_LEASE_KEY;
  const maxBlockRange = parsePositiveInt(
    env[FENN_MARKET_WATCH_MAX_BLOCK_RANGE_ENV],
    MARKET_WATCH_DEFAULT_MAX_BLOCK_RANGE,
    MARKET_WATCH_MIN_BLOCK_RANGE,
    MARKET_WATCH_MAX_BLOCK_RANGE_CAP,
  );
  const rpcTimeoutMs = parsePositiveInt(
    env[FENN_MARKET_WATCH_RPC_TIMEOUT_MS_ENV],
    MARKET_WATCH_DEFAULT_RPC_TIMEOUT_MS,
    1_000,
    120_000,
  );
  const leaseTtlSeconds = pollSeconds + MARKET_WATCH_LEASE_TTL_PADDING_SECONDS;

  return {
    mode,
    pollSeconds,
    leaseKey,
    leaseTtlSeconds,
    maxBlockRange,
    rpcTimeoutMs,
    workerVersion: MARKET_WATCH_WORKER_VERSION,
  };
}

export function officialSourceKey(poolAddress: string): string {
  return `${MARKET_WATCH_SOURCE_KEY_PREFIX}:${poolAddress.toLowerCase()}`;
}
