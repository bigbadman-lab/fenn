import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { explorerAddressUrl } from "@/lib/greenwood/hollow/explorer";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { TreasuryError } from "@/lib/treasury/errors";
import type {
  OfficialFennTokenAsset,
  OfficialFennTokenLookup,
  OfficialTokenCandidateRow,
  PublicOfficialFennToken,
} from "@/lib/treasury/types";
import {
  isNormalizedEvmAddress,
  parseEvmAddress,
} from "@/lib/wallet/evm";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function metaFlagTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function hasOfficialPublicFlags(
  metadata: OfficialTokenCandidateRow["metadata"],
): boolean {
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return (
    metaFlagTrue(metadata.official) && metaFlagTrue(metadata.public_contract)
  );
}

/**
 * Pure selection of the official public FENN token from candidate rows.
 * Prefer trusted DB filters first; this is the single arbitration rule.
 *
 * Criteria (all required):
 * - chain_id = 4663
 * - contract_address present
 * - is_tracked = true
 * - metadata.official and metadata.public_contract truthy
 * - symbol is FENN (case-insensitive consistency check)
 *
 * Ambiguous (multiple) or invalid rows fail closed — no arbitrary pick.
 */
export function resolveOfficialFennToken(
  rows: OfficialTokenCandidateRow[],
): OfficialFennTokenLookup {
  const candidates = rows.filter((row) => {
    if (row.chain_id !== ROBINHOOD_CHAIN_ID) return false;
    if (!row.is_tracked) return false;
    if (row.contract_address == null || row.contract_address.trim() === "") {
      return false;
    }
    return hasOfficialPublicFlags(row.metadata);
  });

  if (candidates.length === 0) {
    return { status: "none" };
  }

  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      count: candidates.length,
    };
  }

  const row = candidates[0];
  if (row.symbol.trim().toLowerCase() !== "fenn") {
    return { status: "invalid", reason: "symbol_mismatch" };
  }

  if (
    !Number.isInteger(row.decimals) ||
    row.decimals < 0 ||
    row.decimals > 255
  ) {
    return { status: "invalid", reason: "invalid_decimals" };
  }

  const raw = row.contract_address!.trim().toLowerCase();
  if (!isNormalizedEvmAddress(raw)) {
    return { status: "invalid", reason: "invalid_address" };
  }

  let contractAddress: string;
  try {
    contractAddress = parseEvmAddress(raw);
  } catch {
    return { status: "invalid", reason: "invalid_address" };
  }

  const token: OfficialFennTokenAsset = {
    symbol: "FENN",
    name: row.name,
    chainId: ROBINHOOD_CHAIN_ID,
    contractAddress,
    decimals: row.decimals,
  };

  return { status: "ok", token };
}

/** Safe public fields for UI / GET /api/treasury — no metadata or internal ids. */
export function toPublicOfficialFennToken(
  token: OfficialFennTokenAsset,
): PublicOfficialFennToken | null {
  const explorerUrl = explorerAddressUrl(token.chainId, token.contractAddress);
  if (!explorerUrl) return null;
  return {
    symbol: "FENN",
    chainId: token.chainId,
    contractAddress: token.contractAddress,
    explorerUrl,
  };
}

/**
 * Load official FENN token candidates from treasury_assets.
 * Filtered at the database where practical; pure resolve applies the rule set.
 */
export async function listOfficialFennTokenCandidates(
  admin?: SupabaseClient,
): Promise<OfficialTokenCandidateRow[]> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("treasury_assets")
    .select(
      "id, symbol, name, chain_id, contract_address, decimals, is_tracked, metadata",
    )
    .eq("chain_id", ROBINHOOD_CHAIN_ID)
    .eq("is_tracked", true)
    .not("contract_address", "is", null);

  if (error) {
    throw new TreasuryError(
      "treasury_config_failed",
      "Failed to load official FENN token candidates",
      500,
    );
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    symbol: String(row.symbol),
    name: row.name == null ? null : String(row.name),
    chain_id: Number(row.chain_id),
    contract_address:
      row.contract_address == null ? null : String(row.contract_address),
    decimals: Number(row.decimals),
    is_tracked: Boolean(row.is_tracked),
    metadata:
      row.metadata != null && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : null,
  }));
}

export async function getOfficialFennTokenLookup(
  admin?: SupabaseClient,
): Promise<OfficialFennTokenLookup> {
  const rows = await listOfficialFennTokenCandidates(admin);
  return resolveOfficialFennToken(rows);
}

function logLookupFailure(lookup: OfficialFennTokenLookup): void {
  if (lookup.status === "ambiguous") {
    console.error("[treasury] official FENN token ambiguous", {
      code: "official_token_ambiguous",
      chainId: ROBINHOOD_CHAIN_ID,
      count: lookup.count,
    });
    return;
  }
  if (lookup.status === "invalid") {
    console.error("[treasury] official FENN token invalid", {
      code: "official_token_invalid",
      reason: lookup.reason,
      chainId: ROBINHOOD_CHAIN_ID,
    });
  }
}

/**
 * Trusted server-side official FENN token definition (no balances).
 * Fails closed (null) on missing, ambiguous, or invalid configuration.
 */
export async function getOfficialFennTokenAsset(
  loadLookup: () => Promise<OfficialFennTokenLookup> = getOfficialFennTokenLookup,
): Promise<OfficialFennTokenAsset | null> {
  try {
    const lookup = await loadLookup();
    if (lookup.status === "ok") return lookup.token;
    if (lookup.status !== "none") logLookupFailure(lookup);
    return null;
  } catch (error) {
    if (error instanceof TreasuryError) {
      console.error("[treasury] official FENN token lookup failed", {
        code: error.code,
      });
    } else {
      console.error("[treasury] official FENN token lookup failed", error);
    }
    return null;
  }
}

/**
 * Public null-safe official FENN token for pages and API.
 * Never throws for empty / ambiguous / invalid config — fails closed to null.
 */
export async function getPublicOfficialFennToken(
  loadLookup: () => Promise<OfficialFennTokenLookup> = getOfficialFennTokenLookup,
): Promise<PublicOfficialFennToken | null> {
  const token = await getOfficialFennTokenAsset(loadLookup);
  if (!token) return null;
  return toPublicOfficialFennToken(token);
}
