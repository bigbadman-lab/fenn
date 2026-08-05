/**
 * Formal Market Watch operational thresholds (1.0D).
 * Used by Desk readiness, worker recovery, and docs — not scattered magic numbers.
 */

/** Heartbeat older than this ⇒ STALE / may STALL active modes. */
export const MARKET_WATCH_HEARTBEAT_STALE_SECONDS = 90;

/**
 * Lag ≤ confirmationDepth is expected "confirming" lag.
 * Lag ≤ confirmationDepth + slack is normal "behind tip".
 * Lag above that is processing lag (degraded).
 */
export const MARKET_WATCH_PROCESSING_LAG_SLACK = 20;

/** Lag (blocks) above confirmationDepth + this → cursor STALLED-level lag. */
export const MARKET_WATCH_STALLED_LAG_OVER_CONFIRM = 200;

/** Max blocks to walk back when resolving a reorg common ancestor. */
export const MARKET_WATCH_REORG_MAX_REWIND_BLOCKS = 64;

/** Floor for adaptive getLogs block span after provider range errors. */
export const MARKET_WATCH_BLOCK_RANGE_FLOOR = 25;

/** RPC attempts per op within one tick (not infinite). */
export const MARKET_WATCH_RPC_MAX_ATTEMPTS = 3;

/** Base backoff for RPC retries (ms); doubled per attempt with jitter. */
export const MARKET_WATCH_RPC_BASE_BACKOFF_MS = 400;

/** Max jitter fraction [0, 1) applied to backoff. */
export const MARKET_WATCH_RPC_JITTER = 0.25;

/** Default max getLogs span (also env-clamped). */
export const MARKET_WATCH_DEFAULT_MAX_BLOCK_RANGE = 500;

/** Max blocks per dry-run verify / replay section. */
export const MARKET_WATCH_VERIFY_MAX_SPAN = 5000;

export const MARKET_WATCH_WORKER_VERSION = "1.0d";
