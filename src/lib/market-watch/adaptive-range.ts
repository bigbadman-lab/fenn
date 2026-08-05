/**
 * Pure adaptive range + RPC error classification (no I/O).
 */

import {
  MARKET_WATCH_BLOCK_RANGE_FLOOR,
  MARKET_WATCH_RPC_BASE_BACKOFF_MS,
  MARKET_WATCH_RPC_JITTER,
} from "@/lib/market-watch/thresholds";

/**
 * Detect common provider messages for eth_getLogs range limits / rate limits.
 */
export function classifyRpcFailure(error: unknown): {
  kind:
    | "range_limit"
    | "rate_limit"
    | "server_error"
    | "timeout"
    | "malformed"
    | "unknown";
  message: string;
} {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown";
  const m = message.toLowerCase();

  if (
    m.includes("block range") ||
    m.includes("query returned more than") ||
    m.includes("response size exceeded") ||
    m.includes("log response size") ||
    m.includes("range is too large") ||
    m.includes("exceeds the max")
  ) {
    return { kind: "range_limit", message };
  }
  if (
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("too many requests") ||
    m.includes("capacity")
  ) {
    return { kind: "rate_limit", message };
  }
  if (
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("aborted") ||
    m.includes("etimedout")
  ) {
    return { kind: "timeout", message };
  }
  if (
    m.includes("500") ||
    m.includes("502") ||
    m.includes("503") ||
    m.includes("504") ||
    m.includes("server error") ||
    m.includes("internal error")
  ) {
    return { kind: "server_error", message };
  }
  if (
    m.includes("invalid") ||
    m.includes("parse") ||
    m.includes("json") ||
    m.includes("unexpected")
  ) {
    return { kind: "malformed", message };
  }
  return { kind: "unknown", message };
}

/**
 * Halve block range after provider range limit. Floors at BLOCK_RANGE_FLOOR.
 */
export function nextRangeAfterLimitError(
  current: number,
  floor: number = MARKET_WATCH_BLOCK_RANGE_FLOOR,
): number {
  const next = Math.floor(current / 2);
  return Math.max(floor, next);
}

/**
 * Exponential backoff with optional deterministic jitter (tests pass jitter 0).
 */
export function rpcBackoffMs(
  attemptZeroBased: number,
  baseMs: number = MARKET_WATCH_RPC_BASE_BACKOFF_MS,
  jitterFraction: number = MARKET_WATCH_RPC_JITTER,
  random: () => number = Math.random,
): number {
  const exp = baseMs * 2 ** Math.max(0, attemptZeroBased);
  const jitter = exp * jitterFraction * random();
  return Math.floor(exp + jitter);
}
