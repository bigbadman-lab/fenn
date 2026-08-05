/**
 * Market Watch domain errors (codes only; safe for ops/logs).
 */

export type MarketWatchErrorCode =
  | "mw_disabled"
  | "mw_not_configured"
  | "mw_config_invalid"
  | "mw_rpc_unavailable"
  | "mw_rpc_failed"
  | "mw_pool_mismatch"
  | "mw_unsupported_pool_kind"
  | "mw_lease_busy"
  | "mw_cursor_reorg"
  | "mw_persist_failed"
  | "mw_internal"
  | "mw_range_invalid";

export class MarketWatchError extends Error {
  readonly code: MarketWatchErrorCode;
  readonly status: number;

  constructor(code: MarketWatchErrorCode, message: string, status = 500) {
    super(message);
    this.name = "MarketWatchError";
    this.code = code;
    this.status = status;
  }
}
