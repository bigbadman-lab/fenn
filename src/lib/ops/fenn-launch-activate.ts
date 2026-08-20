/**
 * P2C.2 — One-command official $VELL mint activation (Solana).
 *
 * Writes ONLY treasury_assets.contract_address on the single dormant
 * official/public VELL row (NULL → validated Solana mint).
 *
 * Never: overwrites a live mint, touches Robinhood ETH/ERC-20 rows, changes
 * decimals/symbol/metadata, activates settlement, funds Purse, claims
 * economic effects, or posts to X.
 */

import "server-only";

import { SOLANA_MAINNET_CHAIN_ID } from "@/lib/treasury/chain-definition";
import {
  isNormalizedSolanaAddress,
  parseSolanaAddress,
  solanaAddressesEqual,
} from "@/lib/wallet/solana";

export const FENN_LAUNCH_ACTIVATE_MODE = "FENN_LAUNCH_ACTIVATE" as const;

export const EXPECTED_OFFICIAL_SYMBOL = "VELL" as const;
export const EXPECTED_OFFICIAL_DECIMALS = 6 as const;
export const EXPECTED_ASSET_TYPE = "spl" as const;

export type FennLaunchActivateStatus =
  | "CONFIGURED"
  | "ALREADY_CONFIGURED"
  | "REFUSED";

export type FennLaunchActivateErrorCode =
  | "missing_contract"
  | "invalid_contract_address"
  | "official_row_missing"
  | "multiple_official_candidates"
  | "symbol_mismatch"
  | "decimals_not_6"
  | "chain_mismatch"
  | "not_tracked"
  | "asset_type_not_spl"
  | "official_flag_missing"
  | "public_contract_flag_missing"
  | "official_contract_already_configured"
  | "dormant_row_race"
  | "write_failed";

export type ActivateCandidateRow = {
  id: string;
  symbol: string;
  name: string | null;
  chain_id: number;
  contract_address: string | null;
  decimals: number;
  is_tracked: boolean;
  metadata: Record<string, unknown> | null;
};

export type FennLaunchActivateReport = {
  mode: typeof FENN_LAUNCH_ACTIVATE_MODE;
  status: FennLaunchActivateStatus;
  errorCode: FennLaunchActivateErrorCode | null;
  errorMessage: string | null;
  symbol: typeof EXPECTED_OFFICIAL_SYMBOL | null;
  chainId: typeof SOLANA_MAINNET_CHAIN_ID | null;
  decimals: number | null;
  contractAddress: string | null;
  official: boolean | null;
  publicContract: boolean | null;
  settlementActivated: false;
  chainBroadcastAttempted: false;
  /** true only when the intended DB configuration write was attempted. */
  sideEffectsAttempted: boolean;
  next: string[] | null;
  notes: string[];
};

export type GuardedSetContractResult = {
  updated: boolean;
  row: ActivateCandidateRow | null;
  errorMessage?: string;
};

export type FennLaunchActivateDeps = {
  listActivateCandidates?: () => Promise<ActivateCandidateRow[]>;
  guardedSetOfficialContract?: (input: {
    id: string;
    contractAddress: string;
  }) => Promise<GuardedSetContractResult>;
};

function metaFlagTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function assetTypeOf(metadata: ActivateCandidateRow["metadata"]): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata.asset_type;
  if (raw == null) return null;
  return String(raw).trim().toLowerCase();
}

export function isOfficialPublicMetadata(
  metadata: ActivateCandidateRow["metadata"],
): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  return (
    metaFlagTrue(metadata.official) && metaFlagTrue(metadata.public_contract)
  );
}

function refused(
  errorCode: FennLaunchActivateErrorCode,
  errorMessage: string,
  sideEffectsAttempted: boolean,
  extras: Partial<FennLaunchActivateReport> = {},
): FennLaunchActivateReport {
  return {
    mode: FENN_LAUNCH_ACTIVATE_MODE,
    status: "REFUSED",
    errorCode,
    errorMessage,
    symbol: null,
    chainId: null,
    decimals: null,
    contractAddress: null,
    official: null,
    publicContract: null,
    settlementActivated: false,
    chainBroadcastAttempted: false,
    sideEffectsAttempted,
    next: null,
    notes: [],
    ...extras,
  };
}

function successConfigured(
  contractAddress: string,
  sideEffectsAttempted: boolean,
  status: "CONFIGURED" | "ALREADY_CONFIGURED",
  notes: string[] = [],
): FennLaunchActivateReport {
  return {
    mode: FENN_LAUNCH_ACTIVATE_MODE,
    status,
    errorCode: null,
    errorMessage: null,
    symbol: EXPECTED_OFFICIAL_SYMBOL,
    chainId: SOLANA_MAINNET_CHAIN_ID,
    decimals: EXPECTED_OFFICIAL_DECIMALS,
    contractAddress,
    official: true,
    publicContract: true,
    settlementActivated: false,
    chainBroadcastAttempted: false,
    sideEffectsAttempted,
    next:
      status === "CONFIGURED"
        ? [
            "homepage header will show the Solana mint within ~30s (no redeploy)",
            "run: npm run launch:check",
            "Purse fund-launch remains deferred until Solana purse path exists",
          ]
        : null,
    notes,
  };
}

/**
 * Parse `--contract <addr>` from argv (slice after node/script).
 * Returns null when flag missing entirely; empty string when flag present but empty.
 */
export function parseContractCliArg(argv: string[]): {
  present: boolean;
  value: string | null;
} {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--contract") {
      const next = argv[i + 1];
      if (next == null || next.startsWith("--")) {
        return { present: true, value: "" };
      }
      return { present: true, value: next };
    }
    if (a.startsWith("--contract=")) {
      return { present: true, value: a.slice("--contract=".length) };
    }
  }
  return { present: false, value: null };
}

function isDormantAddress(addr: string | null): boolean {
  return addr == null || addr.trim() === "";
}

/**
 * Validate identity of a single official/public activate candidate
 * (before any write). Does not check contract null/non-null alone.
 */
export function validateActivateCandidateIdentity(
  row: ActivateCandidateRow,
): FennLaunchActivateErrorCode | null {
  if (row.chain_id !== SOLANA_MAINNET_CHAIN_ID) return "chain_mismatch";
  if (row.symbol.trim().toLowerCase() !== "vell") return "symbol_mismatch";
  if (row.decimals !== EXPECTED_OFFICIAL_DECIMALS) return "decimals_not_6";
  if (!row.is_tracked) return "not_tracked";
  if (!row.metadata || typeof row.metadata !== "object") {
    return "official_flag_missing";
  }
  if (!metaFlagTrue(row.metadata.official)) return "official_flag_missing";
  if (!metaFlagTrue(row.metadata.public_contract)) {
    return "public_contract_flag_missing";
  }
  if (assetTypeOf(row.metadata) !== EXPECTED_ASSET_TYPE) {
    return "asset_type_not_spl";
  }
  return null;
}

async function defaultListActivateCandidates(): Promise<ActivateCandidateRow[]> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  const { data, error } = await db
    .from("treasury_assets")
    .select(
      "id, symbol, name, chain_id, contract_address, decimals, is_tracked, metadata",
    )
    .eq("chain_id", SOLANA_MAINNET_CHAIN_ID);

  if (error) {
    throw new Error(`treasury_assets_list_failed: ${error.message}`);
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

/**
 * Atomic-style guarded update: only the dormant official VELL row may receive
 * a Solana mint. Zero rows updated ⇒ concurrent race / state change.
 */
async function defaultGuardedSetOfficialContract(input: {
  id: string;
  contractAddress: string;
}): Promise<GuardedSetContractResult> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  const { data, error } = await db
    .from("treasury_assets")
    .update({ contract_address: input.contractAddress })
    .eq("id", input.id)
    .eq("chain_id", SOLANA_MAINNET_CHAIN_ID)
    .ilike("symbol", EXPECTED_OFFICIAL_SYMBOL)
    .eq("decimals", EXPECTED_OFFICIAL_DECIMALS)
    .eq("is_tracked", true)
    .is("contract_address", null)
    .filter("metadata->>official", "eq", "true")
    .filter("metadata->>public_contract", "eq", "true")
    .filter("metadata->>asset_type", "eq", EXPECTED_ASSET_TYPE)
    .select(
      "id, symbol, name, chain_id, contract_address, decimals, is_tracked, metadata",
    );

  if (error) {
    return {
      updated: false,
      row: null,
      errorMessage: error.message,
    };
  }

  const rows = (data ?? []).map((row) => ({
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

  if (rows.length !== 1) {
    return { updated: false, row: null };
  }

  const row = rows[0]!;
  if (validateActivateCandidateIdentity(row) != null) {
    return {
      updated: false,
      row: null,
      errorMessage: "post_write_identity_failed",
    };
  }
  if (
    row.contract_address == null ||
    !solanaAddressesEqual(row.contract_address, input.contractAddress)
  ) {
    return {
      updated: false,
      row: null,
      errorMessage: "post_write_address_mismatch",
    };
  }

  return { updated: true, row };
}

/**
 * Configure official $VELL Solana mint on the dormant treasury row.
 */
export async function runFennLaunchActivate(
  input: { contract: string | null | undefined },
  deps: FennLaunchActivateDeps = {},
): Promise<FennLaunchActivateReport> {
  const raw = input.contract;
  if (raw == null || String(raw).trim() === "") {
    return refused(
      "missing_contract",
      "Missing --contract <mint>. Usage: npm run vell:activate -- --contract <SolanaMint>",
      false,
    );
  }

  let contractAddress: string;
  try {
    contractAddress = parseSolanaAddress(String(raw));
  } catch {
    return refused(
      "invalid_contract_address",
      `Invalid Solana mint (base58, 32–44 chars): ${String(raw).slice(0, 80)}`,
      false,
    );
  }

  if (!isNormalizedSolanaAddress(contractAddress)) {
    return refused(
      "invalid_contract_address",
      "Invalid Solana mint after normalize",
      false,
    );
  }

  let allRows: ActivateCandidateRow[];
  try {
    allRows = await (deps.listActivateCandidates ??
      defaultListActivateCandidates)();
  } catch (error) {
    return refused(
      "write_failed",
      error instanceof Error
        ? `list_candidates_failed: ${error.message}`
        : "list_candidates_failed",
      false,
    );
  }

  // Official/public VELL on Solana only — never Robinhood ETH/ERC-20 rows
  const candidates = allRows.filter(
    (r) =>
      r.chain_id === SOLANA_MAINNET_CHAIN_ID &&
      r.symbol.trim().toLowerCase() === "vell" &&
      isOfficialPublicMetadata(r.metadata),
  );

  if (candidates.length === 0) {
    return refused(
      "official_row_missing",
      "No official/public VELL row on Solana chain 101 (run fenn-launch-prep.sql first)",
      false,
    );
  }

  if (candidates.length > 1) {
    return refused(
      "multiple_official_candidates",
      `Multiple official/public VELL rows (${candidates.length}) — refuse activation`,
      false,
    );
  }

  const row = candidates[0]!;
  const identityError = validateActivateCandidateIdentity(row);
  if (identityError) {
    return refused(
      identityError,
      `Official VELL candidate failed identity check: ${identityError}`,
      false,
      {
        symbol: EXPECTED_OFFICIAL_SYMBOL,
        chainId: SOLANA_MAINNET_CHAIN_ID,
        decimals: row.decimals,
        contractAddress: row.contract_address,
      },
    );
  }

  // Already configured
  if (!isDormantAddress(row.contract_address)) {
    const existing = parseSolanaAddressSafe(row.contract_address!);
    if (existing && solanaAddressesEqual(existing, contractAddress)) {
      return successConfigured(contractAddress, false, "ALREADY_CONFIGURED", [
        "mint already set to the same address; no write performed",
      ]);
    }
    return refused(
      "official_contract_already_configured",
      `Official mint already configured as ${row.contract_address}; refusing overwrite with ${contractAddress}`,
      false,
      {
        symbol: EXPECTED_OFFICIAL_SYMBOL,
        chainId: SOLANA_MAINNET_CHAIN_ID,
        decimals: EXPECTED_OFFICIAL_DECIMALS,
        contractAddress: existing ?? row.contract_address,
        official: true,
        publicContract: true,
      },
    );
  }

  // Write path: guarded conditional update
  const write =
    deps.guardedSetOfficialContract ?? defaultGuardedSetOfficialContract;
  const result = await write({
    id: row.id,
    contractAddress,
  });

  if (result.errorMessage && !result.updated) {
    if (result.errorMessage === "post_write_identity_failed") {
      return refused(
        "write_failed",
        "Post-write identity validation failed — investigate treasury_assets",
        true,
      );
    }
    if (
      result.errorMessage !== "post_write_address_mismatch" &&
      result.errorMessage.length > 0
    ) {
      return refused(
        "write_failed",
        `Guarded update failed: ${result.errorMessage}`,
        true,
      );
    }
  }

  if (!result.updated) {
    return refused(
      "dormant_row_race",
      "Guarded update matched 0 rows (mint may have been set concurrently) — refuse; re-run launch:check",
      true,
    );
  }

  return successConfigured(contractAddress, true, "CONFIGURED", [
    "updated treasury_assets.contract_address only on dormant official VELL row",
    "homepage polls /api/home/official-token — refresh to verify",
  ]);
}

function parseSolanaAddressSafe(value: string): string | null {
  try {
    return parseSolanaAddress(value);
  } catch {
    return null;
  }
}

export function formatFennLaunchActivateReport(
  report: FennLaunchActivateReport,
): string {
  const lines = [
    `mode=${report.mode}`,
    `status=${report.status}`,
    report.errorCode ? `errorCode=${report.errorCode}` : null,
    report.errorMessage ? `errorMessage=${report.errorMessage}` : null,
    `symbol=${report.symbol ?? "null"}`,
    `chainId=${report.chainId ?? "null"}`,
    `decimals=${report.decimals ?? "null"}`,
    `contractAddress=${report.contractAddress ?? "null"}`,
    `official=${report.official ?? "null"}`,
    `publicContract=${report.publicContract ?? "null"}`,
    `settlementActivated=${report.settlementActivated}`,
    `chainBroadcastAttempted=${report.chainBroadcastAttempted}`,
    `sideEffectsAttempted=${report.sideEffectsAttempted}`,
  ].filter((x): x is string => x != null);

  for (const n of report.notes) {
    lines.push(`note=${n}`);
  }

  if (report.next && report.next.length > 0) {
    lines.push("NEXT:");
    report.next.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
  }

  return lines.join("\n");
}
