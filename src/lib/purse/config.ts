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
  official_settlement_activated_at?: string | null;
  economic_settlement_enabled?: boolean | null;
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
    .select(
      "purse_wallet_address, is_enabled, official_settlement_activated_at, economic_settlement_enabled",
    )
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

  const activatedRaw = row.official_settlement_activated_at;
  const officialSettlementActivatedAt =
    typeof activatedRaw === "string" && activatedRaw.trim()
      ? activatedRaw
      : null;

  // Fail closed if column missing / null from partial schema (not boolean false).
  // After migration, column is NOT NULL DEFAULT true.
  const economicSettlementEnabled =
    typeof row.economic_settlement_enabled === "boolean"
      ? row.economic_settlement_enabled
      : row.economic_settlement_enabled === null ||
          row.economic_settlement_enabled === undefined
        ? null
        : Boolean(row.economic_settlement_enabled);

  return {
    configured: true,
    walletAddress: parseEvmAddress(raw),
    isEnabled: Boolean(row.is_enabled),
    officialSettlementActivatedAt,
    economicSettlementEnabled,
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

/**
 * Atomic set-once official settlement activation.
 * Only call when official FENN successfully resolves.
 * Returns the activation timestamp (new or existing).
 */
export async function tryActivateOfficialSettlement(
  admin?: SupabaseClient,
): Promise<string | null> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db.rpc("try_activate_official_settlement");

  if (error) {
    throw new PurseError(
      "purse_config_failed",
      `official settlement activation failed: ${error.message}`,
      500,
    );
  }

  if (typeof data === "string" && data.trim()) return data;
  if (data == null) return null;
  return String(data);
}
