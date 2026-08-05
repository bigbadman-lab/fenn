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
 *
 * On conflict:
 * - default: leave existing row (no re-publish downgrade). Report as duplicate.
 * - reclassify: update observed/suppressed only (never demote published;
 *   never touch reorged without operator intent).
 */
export async function persistMarketWatchEvent(
  event: MarketWatchEventInsert,
  admin?: AdminLike,
  options?: { reclassify?: boolean },
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

  const msg = error.message?.toLowerCase() ?? "";
  const code = (error as { code?: string }).code;
  const isDup =
    code === "23505" ||
    msg.includes("duplicate") ||
    msg.includes("unique");

  if (!isDup) {
    throw new MarketWatchError(
      "mw_persist_failed",
      "Failed to persist market_watch_event",
      500,
    );
  }

  if (!options?.reclassify) {
    return { outcome: "duplicate" };
  }

  const { data: existing, error: readErr } = await client
    .from("market_watch_events")
    .select("id, status, classification_version")
    .eq("chain_id", event.chainId)
    .eq("transaction_hash", event.transactionHash.toLowerCase())
    .eq("log_index", event.logIndex)
    .maybeSingle();

  if (readErr || !existing) {
    return { outcome: "duplicate" };
  }

  const status = String(existing.status);
  if (status === "published" || status === "reorged") {
    return { outcome: "duplicate" };
  }

  const { error: upErr } = await client
    .from("market_watch_events")
    .update({
      event_type: event.eventType,
      block_number: event.blockNumber.toString(),
      block_hash: event.blockHash,
      block_timestamp: event.blockTimestamp,
      fenn_amount_raw: event.fennAmountRaw.toString(),
      quote_amount_raw: event.quoteAmountRaw.toString(),
      classification_version: event.classificationVersion,
      status: event.status,
      suppress_reason: event.suppressReason,
      published_at: event.publishedAt,
      raw_log: event.rawLog ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .in("status", ["observed", "suppressed"]);

  if (upErr) {
    throw new MarketWatchError(
      "mw_persist_failed",
      "Failed to reclassify market_watch_event",
      500,
    );
  }

  return { outcome: "updated" };
}
