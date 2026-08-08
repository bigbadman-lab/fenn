import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { PurseError } from "@/lib/purse/errors";
import type { PurseConfigState } from "@/lib/purse/types";
import {
  isNormalizedEvmAddress,
  parseEvmAddress,
} from "@/lib/wallet/evm";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type PurseConfigRow = {
  purse_wallet_address: string;
  is_enabled: boolean;
};

/**
 * Canonical Purse wallet from singleton `purse_config`.
 * DB is the only configured application authority for the public address.
 * Private key never comes from the database.
 */
export async function getPurseConfig(
  admin?: SupabaseClient,
): Promise<PurseConfigState> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("purse_config")
    .select("purse_wallet_address, is_enabled")
    .maybeSingle();

  if (error) {
    throw new PurseError(
      "purse_config_failed",
      "Failed to load Purse configuration",
      500,
    );
  }

  if (!data) {
    return { configured: false };
  }

  const row = data as PurseConfigRow;
  const raw = row.purse_wallet_address;
  if (
    typeof raw !== "string" ||
    !isNormalizedEvmAddress(raw.trim().toLowerCase())
  ) {
    throw new PurseError(
      "purse_invalid_address",
      "Purse configuration wallet address is invalid",
      500,
    );
  }

  return {
    configured: true,
    walletAddress: parseEvmAddress(raw),
    isEnabled: Boolean(row.is_enabled),
  };
}

/**
 * Require enabled configured Purse or throw fail-closed.
 */
export async function requireEnabledPurseConfig(
  admin?: SupabaseClient,
): Promise<{ walletAddress: string }> {
  const config = await getPurseConfig(admin);
  if (!config.configured) {
    throw new PurseError(
      "purse_unconfigured",
      "Purse is not configured (purse_config singleton missing)",
      503,
    );
  }
  if (!config.isEnabled) {
    throw new PurseError(
      "purse_disabled",
      "Purse is configured but disabled",
      503,
    );
  }
  return { walletAddress: config.walletAddress };
}
