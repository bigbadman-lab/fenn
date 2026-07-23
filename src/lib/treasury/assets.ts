import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  toTrackedAsset,
  type TreasuryAssetRow,
} from "@/lib/treasury/asset-map";
import { TreasuryError } from "@/lib/treasury/errors";
import type { TreasuryTrackedAsset } from "@/lib/treasury/types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Tracked Treasury asset definitions (not balances).
 * Only `is_tracked = true`. Sorted by display_order, then symbol.
 */
export async function listTrackedTreasuryAssetRows(
  admin?: SupabaseClient,
): Promise<TreasuryAssetRow[]> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("treasury_assets")
    .select(
      "id, symbol, name, chain_id, contract_address, decimals, display_order, is_tracked",
    )
    .eq("is_tracked", true)
    .order("display_order", { ascending: true })
    .order("symbol", { ascending: true });

  if (error) {
    throw new TreasuryError(
      "treasury_config_failed",
      "Failed to load tracked Treasury assets",
      500,
    );
  }

  return (data ?? []) as TreasuryAssetRow[];
}

export async function getTrackedTreasuryAssets(
  admin?: SupabaseClient,
): Promise<TreasuryTrackedAsset[]> {
  const rows = await listTrackedTreasuryAssetRows(admin);
  return rows.map(toTrackedAsset);
}

export { assertAssetOnRobinhoodChain, toTrackedAsset } from "@/lib/treasury/asset-map";
export type { TreasuryAssetRow } from "@/lib/treasury/asset-map";
