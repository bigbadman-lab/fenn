/**
 * Idempotent event persistence for Market Watch.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { MarketWatchError } from "@/lib/market-watch/errors";
import type {
  MarketWatchEventStatus,
  MarketWatchEventType,
} from "@/lib/market-watch/types";

export type MarketWatchEventInsert = {
  chainId: number;
  eventType: MarketWatchEventType;
  tokenAddress: string;
  poolAddress: string;
  quoteTokenAddress: string;
  transactionHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string | null;
  blockTimestamp: string | null;
  fennAmountRaw: bigint;
  quoteAmountRaw: bigint;
  txFrom: string | null;
  classificationVersion: string;
  status: MarketWatchEventStatus;
  suppressReason: string | null;
  publishedAt: string | null;
  /** Bound raw log for ops; keep small. */
  rawLog?: Record<string, unknown> | null;
};

export type PersistEventResult =
  | { outcome: "inserted" }
  | { outcome: "duplicate" }
  | { outcome: "updated" };

type AdminLike = Pick<SupabaseClient, "from">;

async function defaultAdmin(): Promise<AdminLike> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Insert event; unique (chain_id, transaction_hash, log_index) is the idempotency key.
 * On conflict: leave existing row (no re-publish downgrade). Report as duplicate.
 */
export async function persistMarketWatchEvent(
  event: MarketWatchEventInsert,
  admin?: AdminLike,
): Promise<PersistEventResult> {
  const client = admin ?? (await defaultAdmin());
  const row = {
    chain_id: event.chainId,
    event_type: event.eventType,
    token_address: event.tokenAddress,
    pool_address: event.poolAddress,
    quote_token_address: event.quoteTokenAddress,
    transaction_hash: event.transactionHash.toLowerCase(),
    log_index: event.logIndex,
    block_number: event.blockNumber.toString(),
    block_hash: event.blockHash,
    block_timestamp: event.blockTimestamp,
    fenn_amount_raw: event.fennAmountRaw.toString(),
    quote_amount_raw: event.quoteAmountRaw.toString(),
    tx_from: event.txFrom,
    classification_version: event.classificationVersion,
    status: event.status,
    suppress_reason: event.suppressReason,
    published_at: event.publishedAt,
    raw_log: event.rawLog ?? null,
    observed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await client.from("market_watch_events").insert(row);

  if (!error) {
    return { outcome: "inserted" };
  }

  // Unique violation → already persisted.
  const msg = error.message?.toLowerCase() ?? "";
  const code = (error as { code?: string }).code;
  if (
    code === "23505" ||
    msg.includes("duplicate") ||
    msg.includes("unique")
  ) {
    return { outcome: "duplicate" };
  }

  throw new MarketWatchError(
    "mw_persist_failed",
    "Failed to persist market_watch_event",
    500,
  );
}
