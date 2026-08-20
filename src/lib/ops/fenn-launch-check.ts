/**
 * P2C.1 — Read-only FENN launch readiness check.
 *
 * No DB writes. No claims. No broadcast. No settlement activation.
 * Reuses production official-token resolver + purse config + limits.
 */

import "server-only";

import {
  compareEconomicAmountFormatted,
  PURSE_ORIGINAL_ALLOCATION_FORMATTED,
} from "@/lib/agent/economic-amount";
import {
  EconomicAuthorityLimitsError,
  loadProductionEconomicAuthorityLimits,
  PRODUCTION_HARD_MAX_ROLLING_24H_OUTFLOW_FORMATTED,
  PRODUCTION_HARD_MAX_SINGLE_BURN_FORMATTED,
  PRODUCTION_HARD_MAX_SINGLE_TRANSFER_FORMATTED,
} from "@/lib/agent/economic-authority-limits";
import { SOLANA_MAINNET_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { resolveOfficialFennToken } from "@/lib/treasury/official-token";
import type {
  OfficialFennTokenLookup,
  OfficialTokenCandidateRow,
} from "@/lib/treasury/types";
import { getPurseConfig } from "@/lib/purse/config";
import type { PurseConfigState } from "@/lib/purse/types";
import { xAgentRequiresPursePrivateKey } from "@/lib/ops/x-runtime-env";
/** Launch readiness expectation only — not economic authority law. */
export const EXPECTED_INITIAL_PURSE_ALLOCATION_FORMATTED =
  PURSE_ORIGINAL_ALLOCATION_FORMATTED; // "10000000"

export type FennLaunchCheckStatus =
  | "PRE_LAUNCH_READY"
  | "TOKEN_CONFIGURED_AWAITING_ACTIVATION"
  | "TOKEN_CONFIGURED_AWAITING_PURSE_FUNDING"
  | "LIVE_READY"
  | "BRAKED"
  | "CONFIG_ERROR";

export type OfficialFlaggedRow = {
  id: string;
  symbol: string;
  name: string | null;
  chain_id: number;
  contract_address: string | null;
  decimals: number;
  is_tracked: boolean;
  metadata: Record<string, unknown> | null;
};

export type FennLaunchCheckReport = {
  mode: "FENN_LAUNCH_CHECK";
  status: FennLaunchCheckStatus;
  database: {
    officialRowPrepared: boolean;
    officialRowId: string | null;
    officialContractResolved: boolean;
    officialContractAddress: string | null;
    chainId: number | null;
    decimals: number | null;
    symbol: string | null;
  };
  settlement: {
    economicSettlementEnabled: boolean | null;
    officialSettlementActivatedAt: string | null;
    emergencyBrakeEngaged: boolean;
  };
  purse: {
    purseAddress: string | null;
    officialFennBalance: string | null;
    expectedLaunchAllocation: typeof EXPECTED_INITIAL_PURSE_ALLOCATION_FORMATTED;
    allocationSatisfied: boolean | null;
    hasConfirmedOfficialMovements: boolean | null;
    /** Durable Treasury→Purse launch fund op status, if any. */
    launchFundingStatus: string | null;
    launchFundingTxHash: string | null;
    launchFundingConfirmed: boolean;
  };
  limits: {
    maxSingleTransfer: string;
    maxSingleBurn: string;
    maxRolling24hOutflow: string;
    productionProfileValid: boolean;
  };
  runtimeReadiness: {
    officialResolverHealthy: boolean;
    purseExecutorConfigReadable: boolean;
    xAgentDoesNotRequirePurseKey: boolean;
  };
  errors: string[];
  notes: string[];
  chainBroadcastAttempted: false;
  sideEffectsAttempted: false;
};

export type FennLaunchCheckDeps = {
  listOfficialFlaggedRows?: () => Promise<OfficialFlaggedRow[]>;
  getPurseConfig?: () => Promise<PurseConfigState>;
  resolveLookup?: (
    rows: OfficialTokenCandidateRow[],
  ) => OfficialFennTokenLookup;
  readOfficialPurseBalance?: (input: {
    purseAddress: string;
    tokenAddress: string;
    decimals: number;
  }) => Promise<string | null>;
  countConfirmedOfficialMovements?: () => Promise<number>;
  /** Durable launch ceremony row (historical fund), not live balances. */
  loadLaunchFundingOperation?: () => Promise<{
    status: string;
    txHash: string | null;
  } | null>;
  loadLimits?: typeof loadProductionEconomicAuthorityLimits;
  env?: NodeJS.ProcessEnv;
};

function metaFlagTrue(value: unknown): boolean {
  return value === true || value === "true";
}

export function isOfficialPublicMetadata(
  metadata: OfficialFlaggedRow["metadata"],
): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  return (
    metaFlagTrue(metadata.official) && metaFlagTrue(metadata.public_contract)
  );
}

function toCandidate(row: OfficialFlaggedRow): OfficialTokenCandidateRow {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    chain_id: row.chain_id,
    contract_address: row.contract_address,
    decimals: row.decimals,
    is_tracked: row.is_tracked,
    metadata: row.metadata,
  };
}

function isDormantContract(addr: string | null): boolean {
  return addr == null || addr.trim() === "";
}

/**
 * Pure launch status classifier.
 *
 * LIVE_READY initial fund gate:
 * - allocationSatisfied = balance >= 10000000 when balance is known.
 * - While confirmed official movements = 0: require allocationSatisfied for LIVE_READY.
 * - After any confirmed official movement: LIVE_READY no longer requires 10m
 *   (Purse may spend; reduced balance is operational, not a broken launch).
 */
export function classifyFennLaunchStatus(input: {
  flaggedRows: OfficialFlaggedRow[];
  lookup: OfficialFennTokenLookup;
  purse: PurseConfigState;
  limitsOk: boolean;
  limitsError?: string | null;
  officialBalance: string | null;
  confirmedOfficialMovements: number | null;
}): {
  status: FennLaunchCheckStatus;
  errors: string[];
  notes: string[];
  officialRowPrepared: boolean;
  officialRowId: string | null;
  allocationSatisfied: boolean | null;
} {
  const errors: string[] = [];
  const notes: string[] = [];

  const officialPublic = input.flaggedRows.filter(
    (r) =>
      r.chain_id === SOLANA_MAINNET_CHAIN_ID &&
      isOfficialPublicMetadata(r.metadata),
  );

  if (officialPublic.length > 1) {
    errors.push(`multiple_official_public_rows:${officialPublic.length}`);
  }
  if (officialPublic.length === 0) {
    errors.push("official_row_missing");
  }

  const only = officialPublic.length === 1 ? officialPublic[0]! : null;
  const dormant = only && isDormantContract(only.contract_address) ? only : null;
  const withContract =
    only && !isDormantContract(only.contract_address) ? only : null;

  if (dormant) {
    if (dormant.symbol.trim().toLowerCase() !== "vell") {
      errors.push("official_row_symbol_mismatch");
    }
    if (dormant.decimals !== 6) {
      errors.push("official_row_decimals_not_6");
    }
    if (!dormant.is_tracked) {
      errors.push("official_row_not_tracked");
    }
  }

  if (input.lookup.status === "ambiguous") {
    errors.push(`official_resolver_ambiguous:${input.lookup.count}`);
  }
  if (input.lookup.status === "invalid") {
    errors.push(`official_resolver_invalid:${input.lookup.reason}`);
  }

  if (!input.limitsOk) {
    errors.push(input.limitsError ?? "production_limits_invalid");
  }

  // Narrow purse before field access (configured:false has no settlement fields).
  const purse = input.purse.configured ? input.purse : null;
  const economicSettlementEnabled = purse?.economicSettlementEnabled ?? null;
  const activatedAt = purse?.officialSettlementActivatedAt ?? null;

  if (!purse) {
    errors.push("purse_config_unreadable");
  } else if (economicSettlementEnabled === null) {
    errors.push("economic_settlement_enabled_unknown");
  }

  let allocationSatisfied: boolean | null = null;
  if (input.lookup.status === "ok" && input.officialBalance != null) {
    try {
      allocationSatisfied =
        compareEconomicAmountFormatted(
          input.officialBalance,
          EXPECTED_INITIAL_PURSE_ALLOCATION_FORMATTED,
          6,
        ) >= 0;
    } catch {
      errors.push("purse_balance_unparseable");
    }
  }

  const rowId = dormant?.id ?? withContract?.id ?? null;
  const prepared = Boolean(dormant) || input.lookup.status === "ok";

  // Structural config errors (before brake / readiness pathways)
  const structuralError =
    errors.includes("official_row_missing") ||
    errors.some((e) => e.startsWith("multiple_")) ||
    errors.some((e) => e.startsWith("official_row_")) ||
    errors.some((e) => e.startsWith("official_resolver_")) ||
    errors.includes("purse_config_unreadable") ||
    errors.includes("economic_settlement_enabled_unknown") ||
    !input.limitsOk ||
    errors.includes("purse_balance_unparseable");

  if (structuralError) {
    return {
      status: "CONFIG_ERROR",
      errors,
      notes,
      officialRowPrepared: Boolean(dormant),
      officialRowId: rowId,
      allocationSatisfied,
    };
  }

  if (economicSettlementEnabled === false) {
    notes.push("economic_settlement_enabled=false emergency brake engaged");
    return {
      status: "BRAKED",
      errors,
      notes,
      officialRowPrepared: prepared,
      officialRowId: rowId,
      allocationSatisfied,
    };
  }

  const contractResolved = input.lookup.status === "ok";

  // PRE_LAUNCH_READY
  if (
    dormant &&
    !contractResolved &&
    activatedAt == null &&
    economicSettlementEnabled === true
  ) {
    notes.push(
      "dormant official row present; resolver correctly reports official unavailable",
    );
    return {
      status: "PRE_LAUNCH_READY",
      errors,
      notes,
      officialRowPrepared: true,
      officialRowId: dormant.id,
      allocationSatisfied: null,
    };
  }

  if (!contractResolved) {
    errors.push("official_contract_unresolved");
    return {
      status: "CONFIG_ERROR",
      errors,
      notes,
      officialRowPrepared: Boolean(dormant),
      officialRowId: rowId,
      allocationSatisfied,
    };
  }

  const token = input.lookup.status === "ok" ? input.lookup.token : null;
  if (!token) {
    return {
      status: "CONFIG_ERROR",
      errors: [...errors, "official_lookup_incoherent"],
      notes,
      officialRowPrepared: true,
      officialRowId: rowId,
      allocationSatisfied,
    };
  }
  if (token.chainId !== SOLANA_MAINNET_CHAIN_ID) {
    return {
      status: "CONFIG_ERROR",
      errors: [...errors, "resolved_wrong_chain"],
      notes,
      officialRowPrepared: true,
      officialRowId: rowId,
      allocationSatisfied,
    };
  }
  if (token.decimals !== 6) {
    return {
      status: "CONFIG_ERROR",
      errors: [...errors, "resolved_decimals_not_6"],
      notes,
      officialRowPrepared: true,
      officialRowId: rowId,
      allocationSatisfied,
    };
  }

  if (!activatedAt) {
    notes.push(
      "official token resolves; activation timestamp still NULL until Purse Executor ticks",
    );
    return {
      status: "TOKEN_CONFIGURED_AWAITING_ACTIVATION",
      errors,
      notes,
      officialRowPrepared: true,
      officialRowId: rowId,
      allocationSatisfied,
    };
  }

  const movements = input.confirmedOfficialMovements;
  const hasMovements = movements != null && movements > 0;
  const noMovementsYet = movements != null && movements === 0;

  // Initial fund gate (only before first confirmed official movement)
  if (noMovementsYet && allocationSatisfied !== true) {
    notes.push(
      "activation present; awaiting Purse balance >= 10000000 FENN (no confirmed movements yet)",
    );
    return {
      status: "TOKEN_CONFIGURED_AWAITING_PURSE_FUNDING",
      errors,
      notes,
      officialRowPrepared: true,
      officialRowId: rowId,
      allocationSatisfied,
    };
  }

  if (movements == null && allocationSatisfied === false) {
    notes.push(
      "activation present; movement history unread — low balance treated as awaiting funding",
    );
    return {
      status: "TOKEN_CONFIGURED_AWAITING_PURSE_FUNDING",
      errors,
      notes,
      officialRowPrepared: true,
      officialRowId: rowId,
      allocationSatisfied,
    };
  }

  if (hasMovements) {
    notes.push(
      "confirmed official movements exist — initial 10m fund gate no longer required for LIVE_READY",
    );
  } else if (allocationSatisfied === true) {
    notes.push("initial Purse allocation >= 10000000 FENN satisfied");
  }

  if (
    economicSettlementEnabled === true &&
    activatedAt &&
    (hasMovements || allocationSatisfied === true)
  ) {
    return {
      status: "LIVE_READY",
      errors,
      notes,
      officialRowPrepared: true,
      officialRowId: rowId,
      allocationSatisfied,
    };
  }

  return {
    status: "TOKEN_CONFIGURED_AWAITING_PURSE_FUNDING",
    errors,
    notes,
    officialRowPrepared: true,
    officialRowId: rowId,
    allocationSatisfied,
  };
}

async function defaultListOfficialFlaggedRows(): Promise<OfficialFlaggedRow[]> {
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

  return (data ?? [])
    .map((row) => ({
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
    }))
    .filter((r) => isOfficialPublicMetadata(r.metadata));
}

/** Read-only launch check (no mutations). */
export async function runFennLaunchCheck(
  deps: FennLaunchCheckDeps = {},
): Promise<FennLaunchCheckReport> {
  const preErrors: string[] = [];
  const preNotes: string[] = [];

  let flaggedRows: OfficialFlaggedRow[] = [];
  try {
    flaggedRows = await (deps.listOfficialFlaggedRows ??
      defaultListOfficialFlaggedRows)();
  } catch (error) {
    preErrors.push(
      error instanceof Error
        ? `flagged_rows_failed:${error.message}`
        : "flagged_rows_failed",
    );
  }

  const candidates = flaggedRows.map(toCandidate);
  const resolve = deps.resolveLookup ?? resolveOfficialFennToken;
  const lookup = resolve(candidates);

  let limitsOk = false;
  let limitsError: string | null = null;
  // Widen to string: production hard-max consts are literal strings, but loaded
  // ceilings may be strictly smaller env-tightened values.
  let maxTransfer: string = PRODUCTION_HARD_MAX_SINGLE_TRANSFER_FORMATTED;
  let maxBurn: string = PRODUCTION_HARD_MAX_SINGLE_BURN_FORMATTED;
  let maxRolling: string = PRODUCTION_HARD_MAX_ROLLING_24H_OUTFLOW_FORMATTED;
  try {
    const loadLimits =
      deps.loadLimits ?? loadProductionEconomicAuthorityLimits;
    const limits = loadLimits(deps.env ?? process.env);
    maxTransfer = limits.maxSingleTransferFormatted;
    maxBurn = limits.maxSingleBurnFormatted;
    maxRolling = limits.maxRolling24hOutflowFormatted;
    limitsOk = true;
  } catch (error) {
    limitsOk = false;
    limitsError =
      error instanceof EconomicAuthorityLimitsError
        ? error.code
        : "production_limits_invalid";
  }

  let purse: PurseConfigState = { configured: false };
  let purseReadable = false;
  try {
    purse = await (deps.getPurseConfig ?? getPurseConfig)();
    purseReadable = purse.configured;
  } catch (error) {
    preErrors.push(
      error instanceof Error
        ? `purse_config_failed:${error.message}`
        : "purse_config_failed",
    );
  }

  let officialBalance: string | null = null;
  if (lookup.status === "ok" && purse.configured) {
    try {
      const read =
        deps.readOfficialPurseBalance ??
        (async () => {
          // Official mint is Solana SPL; EVM Purse ERC-20 balance reads do not apply.
          return null;
        });
      if (!deps.readOfficialPurseBalance) {
        preNotes.push(
          "solana_purse_balance_deferred: official mint is SPL; EVM ERC-20 purse balance not read",
        );
      }
      officialBalance = await read({
        purseAddress: purse.walletAddress,
        tokenAddress: lookup.token.contractAddress,
        decimals: lookup.token.decimals,
      });
    } catch (error) {
      preNotes.push(
        error instanceof Error
          ? `balance_read_failed:${error.message.slice(0, 120)}`
          : "balance_read_failed",
      );
    }
  }

  let confirmedMovements: number | null = null;
  if (lookup.status === "ok") {
    try {
      if (deps.countConfirmedOfficialMovements) {
        confirmedMovements = await deps.countConfirmedOfficialMovements();
      } else {
        const { listConfirmedPurseTransfers } = await import(
          "@/lib/purse/transfers-query"
        );
        const more = await listConfirmedPurseTransfers(50);
        confirmedMovements = more.length;
      }
    } catch {
      confirmedMovements = null;
      preNotes.push("confirmed_movements_unread");
    }
  }

  let launchFundingStatus: string | null = null;
  let launchFundingTxHash: string | null = null;
  let launchFundingConfirmed = false;
  try {
    const loadFunding =
      deps.loadLaunchFundingOperation ??
      (async () => {
        const { getLaunchOperationById } = await import(
          "@/lib/ops/fenn-launch-fund-store"
        );
        const { FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID } = await import(
          "@/lib/ops/fenn-launch-fund-constants"
        );
        const op = await getLaunchOperationById(
          FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
        );
        if (!op) return null;
        return { status: op.status, txHash: op.txHash };
      });
    const op = await loadFunding();
    if (op) {
      launchFundingStatus = op.status;
      launchFundingTxHash = op.txHash;
      launchFundingConfirmed = op.status === "confirmed";
      if (launchFundingConfirmed) {
        preNotes.push(
          "durable_launch_funding=confirmed (historical; independent of live Purse balance)",
        );
      } else {
        preNotes.push(`durable_launch_funding=${op.status}`);
      }
    } else {
      launchFundingStatus = null;
      preNotes.push("durable_launch_funding=absent");
    }
  } catch {
    preNotes.push("durable_launch_funding_unread");
  }

  const classified = classifyFennLaunchStatus({
    flaggedRows,
    lookup,
    purse,
    limitsOk,
    limitsError,
    officialBalance,
    confirmedOfficialMovements: confirmedMovements,
  });

  // After durable confirmed funding, treat allocation as satisfied for LIVE_READY
  // even if live balance later declines — historical proof of ceremony.
  let status = classified.status;
  let allocationSatisfied = classified.allocationSatisfied;
  if (launchFundingConfirmed && allocationSatisfied !== true) {
    allocationSatisfied = true;
    if (
      status === "TOKEN_CONFIGURED_AWAITING_PURSE_FUNDING" &&
      purse.configured &&
      purse.economicSettlementEnabled === true &&
      purse.officialSettlementActivatedAt
    ) {
      status = "LIVE_READY";
      preNotes.push(
        "LIVE_READY via durable launch funding (live balance may be below 10m after spend)",
      );
    }
  }

  const allErrors = [...preErrors, ...classified.errors];
  if (preErrors.length > 0 && status !== "BRAKED") {
    status = "CONFIG_ERROR";
  }

  const token = lookup.status === "ok" ? lookup.token : null;
  const dormant = flaggedRows.find((r) => isDormantContract(r.contract_address));

  return {
    mode: "FENN_LAUNCH_CHECK",
    status,
    database: {
      officialRowPrepared: classified.officialRowPrepared,
      officialRowId: classified.officialRowId,
      officialContractResolved: lookup.status === "ok",
      officialContractAddress: token?.contractAddress ?? null,
      chainId: token?.chainId ?? dormant?.chain_id ?? null,
      decimals: token?.decimals ?? dormant?.decimals ?? null,
      symbol: token?.symbol ?? dormant?.symbol ?? null,
    },
    settlement: {
      economicSettlementEnabled: purse.configured
        ? purse.economicSettlementEnabled
        : null,
      officialSettlementActivatedAt: purse.configured
        ? purse.officialSettlementActivatedAt
        : null,
      emergencyBrakeEngaged:
        purse.configured && purse.economicSettlementEnabled === false,
    },
    purse: {
      purseAddress: purse.configured ? purse.walletAddress : null,
      officialFennBalance: officialBalance,
      expectedLaunchAllocation: EXPECTED_INITIAL_PURSE_ALLOCATION_FORMATTED,
      allocationSatisfied,
      hasConfirmedOfficialMovements:
        confirmedMovements == null ? null : confirmedMovements > 0,
      launchFundingStatus,
      launchFundingTxHash,
      launchFundingConfirmed,
    },
    limits: {
      maxSingleTransfer: maxTransfer,
      maxSingleBurn: maxBurn,
      maxRolling24hOutflow: maxRolling,
      productionProfileValid: limitsOk,
    },
    runtimeReadiness: {
      officialResolverHealthy: true,
      purseExecutorConfigReadable: purseReadable,
      xAgentDoesNotRequirePurseKey: !xAgentRequiresPursePrivateKey(),
    },
    errors: allErrors,
    notes: [...preNotes, ...classified.notes],
    chainBroadcastAttempted: false,
    sideEffectsAttempted: false,
  };
}

export function formatFennLaunchCheckReport(
  report: FennLaunchCheckReport,
): string {
  const lines = [
    `mode=${report.mode}`,
    `status=${report.status}`,
    `officialRowPrepared=${report.database.officialRowPrepared}`,
    `officialRowId=${report.database.officialRowId ?? "null"}`,
    `officialContractResolved=${report.database.officialContractResolved}`,
    `officialContractAddress=${report.database.officialContractAddress ?? "null"}`,
    `chainId=${report.database.chainId ?? "null"}`,
    `decimals=${report.database.decimals ?? "null"}`,
    `symbol=${report.database.symbol ?? "null"}`,
    `economicSettlementEnabled=${report.settlement.economicSettlementEnabled}`,
    `officialSettlementActivatedAt=${report.settlement.officialSettlementActivatedAt ?? "null"}`,
    `emergencyBrakeEngaged=${report.settlement.emergencyBrakeEngaged}`,
    `purseAddress=${report.purse.purseAddress ?? "null"}`,
    `officialFennBalance=${report.purse.officialFennBalance ?? "null"}`,
    `expectedLaunchAllocation=${report.purse.expectedLaunchAllocation}`,
    `allocationSatisfied=${report.purse.allocationSatisfied}`,
    `hasConfirmedOfficialMovements=${report.purse.hasConfirmedOfficialMovements}`,
    `launchFundingStatus=${report.purse.launchFundingStatus ?? "null"}`,
    `launchFundingTxHash=${report.purse.launchFundingTxHash ?? "null"}`,
    `launchFundingConfirmed=${report.purse.launchFundingConfirmed}`,
    `maxSingleTransfer=${report.limits.maxSingleTransfer}`,
    `maxSingleBurn=${report.limits.maxSingleBurn}`,
    `maxRolling24hOutflow=${report.limits.maxRolling24hOutflow}`,
    `productionProfileValid=${report.limits.productionProfileValid}`,
    `officialResolverHealthy=${report.runtimeReadiness.officialResolverHealthy}`,
    `purseExecutorConfigReadable=${report.runtimeReadiness.purseExecutorConfigReadable}`,
    `xAgentDoesNotRequirePurseKey=${report.runtimeReadiness.xAgentDoesNotRequirePurseKey}`,
    `chainBroadcastAttempted=${report.chainBroadcastAttempted}`,
    `sideEffectsAttempted=${report.sideEffectsAttempted}`,
  ];
  for (const e of report.errors) lines.push(`error=${e}`);
  for (const n of report.notes) lines.push(`note=${n}`);
  return lines.join("\n");
}

export function isDormantOfficialRowUnresolved(
  rows: OfficialTokenCandidateRow[],
): boolean {
  return resolveOfficialFennToken(rows).status === "none";
}
