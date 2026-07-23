import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { TreasuryError } from "@/lib/treasury/errors";
import type { TreasuryConfigState } from "@/lib/treasury/types";
import {
  isNormalizedEvmAddress,
  parseEvmAddress,
} from "@/lib/wallet/evm";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type TreasuryConfigRow = {
  treasury_wallet_address: string;
};

/**
 * Canonical Treasury wallet from singleton `treasury_config`.
 * DB is the only configured application authority.
 * Does not fall back to FENN_TREASURY_ADDRESS.
 */
export async function getTreasuryConfig(
  admin?: SupabaseClient,
): Promise<TreasuryConfigState> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("treasury_config")
    .select("treasury_wallet_address")
    .maybeSingle();

  if (error) {
    throw new TreasuryError(
      "treasury_config_failed",
      "Failed to load Treasury configuration",
      500,
    );
  }

  if (!data) {
    return { configured: false };
  }

  const row = data as TreasuryConfigRow;
  const raw = row.treasury_wallet_address;
  if (typeof raw !== "string" || !isNormalizedEvmAddress(raw.trim().toLowerCase())) {
    throw new TreasuryError(
      "treasury_invalid_address",
      "Treasury configuration wallet address is invalid",
      500,
    );
  }

  return {
    configured: true,
    walletAddress: parseEvmAddress(raw),
  };
}

/**
 * Explicit env bootstrap aid only.
 * Never overrides a populated DB Treasury address.
 * Callers must not treat this as “configured application Treasury”.
 */
export function readTreasuryBootstrapAddressFromEnv(
  envAddress: string | undefined = process.env.FENN_TREASURY_ADDRESS,
): string | null {
  if (envAddress == null || envAddress.trim().length === 0) {
    return null;
  }
  try {
    return parseEvmAddress(envAddress);
  } catch {
    throw new TreasuryError(
      "treasury_invalid_address",
      "FENN_TREASURY_ADDRESS is not a valid EVM address",
      500,
    );
  }
}
