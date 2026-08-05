/**
 * Market Watch public barrel — types/health for Desk; no client RPC.
 */

export type {
  MarketWatchDeskHealth,
  MarketWatchHealthSnapshot,
  MarketWatchMode,
  MarketWatchPoolKind,
} from "@/lib/market-watch/types";
export {
  parseMarketWatchMode,
  resolveMarketWatchRuntimeConfig,
  FENN_MARKET_WATCH_MODE_ENV,
  MARKET_WATCH_DEFAULT_LEASE_KEY,
  MARKET_WATCH_WORKER_VERSION,
} from "@/lib/market-watch/config";
export { getMarketWatchHealth } from "@/lib/market-watch/health";
export { MarketWatchError } from "@/lib/market-watch/errors";
