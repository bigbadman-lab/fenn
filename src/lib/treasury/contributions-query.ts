import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toPublicTreasuryContribution } from "@/lib/treasury/contributions";
import { TreasuryError } from "@/lib/treasury/errors";
import type { PublicTreasuryContribution } from "@/lib/treasury/types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Verified contribution annotations only.
 * Explanatory history — never used as holdings authority.
 */
export async function getVerifiedTreasuryContributions(
  admin?: SupabaseClient,
  limit = 25,
): Promise<PublicTreasuryContribution[]> {
  const db = admin ?? (await defaultAdmin());
  const pageSize = Math.min(Math.max(1, limit), 100);
  const { data, error } = await db
    .from("treasury_contributions")
    .select(
      "id, asset_symbol, amount, amount_raw, value_usd_at_receipt, tx_hash, from_address, project_name, purpose, designation, verified, verified_at, created_at",
    )
    .eq("verified", true)
    .order("created_at", { ascending: false })
    .limit(pageSize);

  if (error) {
    throw new TreasuryError(
      "treasury_config_failed",
      "Failed to load verified Treasury contributions",
      500,
    );
  }

  return (data ?? []).map((row) =>
    toPublicTreasuryContribution(
      row as Parameters<typeof toPublicTreasuryContribution>[0],
    ),
  );
}
