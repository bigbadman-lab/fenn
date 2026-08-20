import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { solanaAccountExplorerUrl } from "@/lib/commons/public-wallets";
import { SOLANA_MAINNET_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { TreasuryError } from "@/lib/treasury/errors";
import type {
  OfficialFennTokenAsset,
  OfficialFennTokenLookup,
  OfficialTokenCandidateRow,
  PublicOfficialFennToken,
} from "@/lib/treasury/types";
import {
  isNormalizedSolanaAddress,
  parseSolanaAddress,
} from "@/lib/wallet/solana";

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
  if (
    metadata == null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return false;
  }
  return (
    metaFlagTrue(metadata.official) && metaFlagTrue(metadata.public_contract)
  );
}

function isOfficialPublicSymbol(symbol: string): boolean {
  const s = symbol.trim().toLowerCase();
  return s === "vell" || s === "fenn";
}

/**
 * Pure selection of the official public $VELL mint from candidate rows.
 *
 * Criteria (all required):
 * - chain_id = 101 (Solana mainnet sentinel)
 * - contract_address present (Solana mint)
 * - is_tracked = true
 * - metadata.official and metadata.public_contract truthy
 * - symbol is VELL (FENN accepted only as legacy synonym)
 *
 * Ambiguous (multiple) or invalid rows fail closed — no arbitrary pick.
 */
export function resolveOfficialFennToken(
  rows: OfficialTokenCandidateRow[],
): OfficialFennTokenLookup {
  const candidates = rows.filter((row) => {
    if (row.chain_id !== SOLANA_MAINNET_CHAIN_ID) return false;
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

  const row = candidates[0]!;
  if (!isOfficialPublicSymbol(row.symbol)) {
    return { status: "invalid", reason: "symbol_mismatch" };
  }

  if (
    !Number.isInteger(row.decimals) ||
    row.decimals < 0 ||
    row.decimals > 255
  ) {
    return { status: "invalid", reason: "invalid_decimals" };
  }

  const raw = row.contract_address!.trim();
  if (!isNormalizedSolanaAddress(raw)) {
    return { status: "invalid", reason: "invalid_address" };
  }

  let contractAddress: string;
  try {
    contractAddress = parseSolanaAddress(raw);
  } catch {
    return { status: "invalid", reason: "invalid_address" };
  }

  const token: OfficialFennTokenAsset = {
    symbol: "VELL",
    name: row.name,
    chainId: SOLANA_MAINNET_CHAIN_ID,
    contractAddress,
    decimals: row.decimals,
  };

  return { status: "ok", token };
}

/** Safe public fields for UI / GET /api/treasury — no metadata or internal ids. */
export function toPublicOfficialFennToken(
  token: OfficialFennTokenAsset,
): PublicOfficialFennToken | null {
  if (!isNormalizedSolanaAddress(token.contractAddress)) return null;
  return {
    symbol: "VELL",
    chainId: token.chainId,
    contractAddress: token.contractAddress,
    explorerUrl: solanaAccountExplorerUrl(token.contractAddress),
  };
}

/**
 * Load official $VELL mint candidates from treasury_assets.
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
    .eq("chain_id", SOLANA_MAINNET_CHAIN_ID)
    .eq("is_tracked", true)
    .not("contract_address", "is", null);

  if (error) {
    throw new TreasuryError(
      "treasury_config_failed",
      "Failed to load official VELL mint candidates",
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
    console.error("[treasury] official VELL mint ambiguous", {
      code: "official_token_ambiguous",
      chainId: SOLANA_MAINNET_CHAIN_ID,
      count: lookup.count,
    });
    return;
  }
  if (lookup.status === "invalid") {
    console.error("[treasury] official VELL mint invalid", {
      code: "official_token_invalid",
      reason: lookup.reason,
      chainId: SOLANA_MAINNET_CHAIN_ID,
    });
  }
}

/**
 * Trusted server-side official $VELL mint definition (no balances).
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
      console.error("[treasury] official VELL mint lookup failed", {
        code: error.code,
      });
    } else {
      console.error("[treasury] official VELL mint lookup failed", error);
    }
    return null;
  }
}

/**
 * Public null-safe official $VELL mint for pages and API.
 * Never throws for empty / ambiguous / invalid config — fails closed to null.
 */
export async function getPublicOfficialFennToken(
  loadLookup: () => Promise<OfficialFennTokenLookup> = getOfficialFennTokenLookup,
): Promise<PublicOfficialFennToken | null> {
  const token = await getOfficialFennTokenAsset(loadLookup);
  if (!token) return null;
  return toPublicOfficialFennToken(token);
}
