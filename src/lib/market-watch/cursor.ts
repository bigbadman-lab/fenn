/**
 * Durable cursor read/write for Market Watch official pool source.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { MarketWatchError } from "@/lib/market-watch/errors";

export type MarketWatchCursor = {
  sourceKey: string;
  chainId: number;
  poolAddress: string;
  lastSafeBlock: bigint;
  lastSafeBlockHash: string | null;
  classificationVersion: string;
};

type CursorRow = {
  source_key: string;
  chain_id: number;
  pool_address: string;
  last_safe_block: number | string;
  last_safe_block_hash: string | null;
  classification_version: string;
};

function asBigInt(value: number | string): bigint {
  return BigInt(typeof value === "number" ? Math.trunc(value) : value.trim());
}

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export async function readMarketWatchCursor(
  sourceKey: string,
  admin?: SupabaseClient,
): Promise<MarketWatchCursor | null> {
  const client = admin ?? (await defaultAdmin());
  const { data, error } = await client
    .from("market_watch_cursors")
    .select(
      "source_key, chain_id, pool_address, last_safe_block, last_safe_block_hash, classification_version",
    )
    .eq("source_key", sourceKey)
    .maybeSingle();
  if (error) {
    throw new MarketWatchError(
      "mw_internal",
      "Failed to read market_watch_cursors",
      500,
    );
  }
  if (!data) return null;
  const row = data as CursorRow;
  return {
    sourceKey: row.source_key,
    chainId: row.chain_id,
    poolAddress: row.pool_address,
    lastSafeBlock: asBigInt(row.last_safe_block),
    lastSafeBlockHash: row.last_safe_block_hash,
    classificationVersion: row.classification_version,
  };
}

/**
 * Advance cursor only after persistence succeeds for the closed range.
 */
export async function writeMarketWatchCursor(
  cursor: MarketWatchCursor,
  admin?: SupabaseClient,
): Promise<void> {
  const client = admin ?? (await defaultAdmin());
  const { error } = await client.from("market_watch_cursors").upsert(
    {
      source_key: cursor.sourceKey,
      chain_id: cursor.chainId,
      pool_address: cursor.poolAddress,
      last_safe_block: cursor.lastSafeBlock.toString(),
      last_safe_block_hash: cursor.lastSafeBlockHash,
      classification_version: cursor.classificationVersion,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source_key" },
  );
  if (error) {
    throw new MarketWatchError(
      "mw_persist_failed",
      "Failed to write market_watch cursor",
      500,
    );
  }
}
