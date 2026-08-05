/**
 * Safe structured logs for Market Watch. Never log secrets, RPC URLs, or service keys.
 */

export type MarketWatchLogEvent =
  | "worker_start"
  | "worker_stop"
  | "config_valid"
  | "config_invalid"
  | "lease_acquired"
  | "lease_skipped"
  | "tick_start"
  | "tick_end"
  | "logs_fetched"
  | "classified"
  | "suppressed"
  | "duplicate"
  | "cursor_advanced"
  | "rpc_retry"
  | "classification_error"
  | "database_error"
  | "reorg_suspicion"
  | "mode_disabled"
  | "replay_summary";

export type MarketWatchLogFields = {
  event: MarketWatchLogEvent;
  ok?: boolean;
  code?: string;
  mode?: string;
  fromBlock?: number | string;
  toBlock?: number | string;
  logCount?: number;
  acquisitions?: number;
  disposals?: number;
  suppressed?: number;
  duplicates?: number;
  transactionHash?: string;
  detail?: string;
};

function safeLogDetail(value: string | undefined, max = 160): string | undefined {
  if (!value) return undefined;
  return value.replace(/[\r\n\t]+/g, " ").slice(0, max);
}

/**
 * Truncate addresses in logs to a short operational form.
 */
export function shortAddress(value: string | null | undefined): string | undefined {
  if (!value || value.length < 12) return undefined;
  const v = value.toLowerCase();
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

export function logMarketWatch(fields: MarketWatchLogFields): void {
  const line = {
    domain: "market_watch",
    ts: new Date().toISOString(),
    event: fields.event,
    ok: fields.ok,
    code: fields.code,
    mode: fields.mode,
    fromBlock: fields.fromBlock,
    toBlock: fields.toBlock,
    logCount: fields.logCount,
    acquisitions: fields.acquisitions,
    disposals: fields.disposals,
    suppressed: fields.suppressed,
    duplicates: fields.duplicates,
    transactionHash: fields.transactionHash?.toLowerCase(),
    detail: safeLogDetail(fields.detail),
  };
  if (fields.ok === false) {
    console.error(JSON.stringify(line));
  } else {
    console.info(JSON.stringify(line));
  }
}
