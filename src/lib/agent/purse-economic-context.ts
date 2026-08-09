/**
 * Trusted Purse state for Stage 12 economic judgement (P1B / P1C).
 * Never includes private keys or signing material.
 */

import "server-only";

import {
  FENN_TOTAL_SUPPLY_ASSUMPTION_FORMATTED,
  formatRawToDecimalString,
  PURSE_ORIGINAL_ALLOCATION_FORMATTED,
  PURSE_SCALE_REFERENCES,
} from "@/lib/agent/economic-amount";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";
import { getPurseConfig } from "@/lib/purse/config";
import {
  listConfirmedPurseTransfers,
  loadPurseEconomicHistoryStats,
} from "@/lib/purse/transfers-query";
import type { PublicPurseTransfer } from "@/lib/purse/types";
import {
  createRobinhoodPublicClient,
  readErc20Balance,
} from "@/lib/treasury/chain";
import { getOfficialFennTokenAsset } from "@/lib/treasury/official-token";
import { resolveArmedPurseTestToken } from "@/lib/purse/test-mode";
import { officialFennSuccessfullyResolves } from "@/lib/purse/transfer";

export type PurseEconomicEnvironment =
  | "live_official"
  | "p1b_test_harness"
  | "unavailable";

export type PurseEconomicRecentAction = {
  actionType: "transfer" | "burn";
  amountFormatted: string;
  recipientAddress: string | null;
  txHash: string;
  confirmedAt: string;
};

export type PurseEconomicState = {
  purseAddress: string | null;
  isEnabled: boolean;
  environment: PurseEconomicEnvironment;
  officialFennAvailable: boolean;
  officialBalanceFormatted: string | null;
  /** Only set when environment is p1b_test_harness — never labelled as FENN. */
  testBalanceFormatted: string | null;
  remainingBalanceFormatted: string | null;
  /**
   * Token decimals for remaining balance math (trusted, application-owned).
   * Used by authority for amount comparisons — never by the model.
   */
  tokenDecimals: number;
  /** Original allocation reference (scale orientation). */
  originalAllocationFormatted: typeof PURSE_ORIGINAL_ALLOCATION_FORMATTED;
  totalTransferredFormatted: string;
  totalBurnedFormatted: string;
  largestTransferFormatted: string | null;
  largestBurnFormatted: string | null;
  /** Confirmed transfer + burn outflow in last 24h (official non-test, or test rail). */
  rolling24hOutflowFormatted: string;
  confirmedTransferCount: number;
  confirmedBurnCount: number;
  recentActions: PurseEconomicRecentAction[];
  economicExecutionEnabled: boolean;
  deadAddress: typeof FENN_DEAD_ADDRESS;
  /**
   * Test harness only: clearly marks disposable asset.
   * Live prompts never see this as true for ordinary traffic.
   */
  testRailExplicitlyActive: boolean;
  observedAt: string;
};

function isBurnTransfer(row: PublicPurseTransfer): boolean {
  return row.actionType === "burn";
}

function emptyHistory() {
  return {
    totalTransferredFormatted: "0",
    totalBurnedFormatted: "0",
    largestTransferFormatted: null as string | null,
    largestBurnFormatted: null as string | null,
    rolling24hOutflowFormatted: "0",
    confirmedTransferCount: 0,
    confirmedBurnCount: 0,
  };
}

/**
 * Load trusted Purse state for judgement/authority.
 * Live path: official only. Harness may pass forceTestRail.
 */
export async function loadPurseEconomicState(options?: {
  /** Controlled P1B/P1C harness only. */
  forceTestRail?: boolean;
  listConfirmed?: () => Promise<PublicPurseTransfer[]>;
  loadHistory?: (input: {
    includeTest: boolean;
    now: Date;
  }) => Promise<ReturnType<typeof emptyHistory>>;
  now?: () => Date;
}): Promise<PurseEconomicState> {
  const now = options?.now?.() ?? new Date();
  const observedAt = now.toISOString();
  const forceTestRail = Boolean(options?.forceTestRail);

  let purseAddress: string | null = null;
  let isEnabled = false;
  try {
    const config = await getPurseConfig();
    if (config.configured) {
      purseAddress = config.walletAddress;
      isEnabled = config.isEnabled;
    }
  } catch {
    // fail closed below
  }

  const official = await getOfficialFennTokenAsset();
  const officialFennAvailable = officialFennSuccessfullyResolves(official);

  let list: PublicPurseTransfer[] = [];
  try {
    list = options?.listConfirmed
      ? await options.listConfirmed()
      : await listConfirmedPurseTransfers(20);
  } catch {
    list = [];
  }

  const transfers = list.filter((r) => !isBurnTransfer(r));
  const burns = list.filter(isBurnTransfer);
  const recentActions: PurseEconomicRecentAction[] = list.slice(0, 8).map((r) => ({
    actionType: isBurnTransfer(r) ? "burn" : "transfer",
    amountFormatted: r.amountFormatted,
    recipientAddress: isBurnTransfer(r) ? null : r.recipientAddress,
    txHash: r.txHash,
    confirmedAt: r.confirmedAt,
  }));

  let history = emptyHistory();
  try {
    if (options?.loadHistory) {
      history = await options.loadHistory({
        includeTest: forceTestRail,
        now,
      });
    } else {
      history = await loadPurseEconomicHistoryStats({
        includeTest: forceTestRail,
        now,
      });
    }
  } catch {
    history = emptyHistory();
  }

  let officialBalanceFormatted: string | null = null;
  let testBalanceFormatted: string | null = null;
  let remainingBalanceFormatted: string | null = null;
  let tokenDecimals = 18;
  let economicExecutionEnabled = false;
  let environment: PurseEconomicEnvironment = "unavailable";
  let testRailExplicitlyActive = false;

  if (!purseAddress || !isEnabled) {
    return {
      purseAddress,
      isEnabled: false,
      environment: "unavailable",
      officialFennAvailable,
      officialBalanceFormatted: null,
      testBalanceFormatted: null,
      remainingBalanceFormatted: null,
      tokenDecimals,
      originalAllocationFormatted: PURSE_ORIGINAL_ALLOCATION_FORMATTED,
      totalTransferredFormatted: history.totalTransferredFormatted,
      totalBurnedFormatted: history.totalBurnedFormatted,
      largestTransferFormatted: history.largestTransferFormatted,
      largestBurnFormatted: history.largestBurnFormatted,
      rolling24hOutflowFormatted: history.rolling24hOutflowFormatted,
      confirmedTransferCount:
        history.confirmedTransferCount || transfers.length,
      confirmedBurnCount: history.confirmedBurnCount || burns.length,
      recentActions,
      economicExecutionEnabled: false,
      deadAddress: FENN_DEAD_ADDRESS,
      testRailExplicitlyActive: false,
      observedAt,
    };
  }

  const client = createRobinhoodPublicClient();

  if (forceTestRail) {
    testRailExplicitlyActive = true;
    environment = "p1b_test_harness";
    try {
      const testToken = resolveArmedPurseTestToken(process.env);
      tokenDecimals = testToken.decimals;
      const bal = await readErc20Balance({
        tokenAddress: testToken.contractAddress,
        holder: purseAddress,
        decimals: testToken.decimals,
        client,
      });
      testBalanceFormatted = bal.formatted;
      remainingBalanceFormatted = bal.formatted;
      // Authority rechecks raw balance before planning. Harness marks execution
      // open only when disposable rail is armed and official FENN is not live.
      economicExecutionEnabled = !officialFennAvailable && isEnabled;
    } catch {
      economicExecutionEnabled = false;
    }
  } else if (officialFennAvailable && official) {
    environment = "live_official";
    try {
      tokenDecimals = official.decimals;
      const bal = await readErc20Balance({
        tokenAddress: official.contractAddress,
        holder: purseAddress,
        decimals: official.decimals,
        client,
      });
      officialBalanceFormatted = bal.formatted;
      remainingBalanceFormatted = bal.formatted;
      economicExecutionEnabled = isEnabled;
    } catch {
      officialBalanceFormatted = null;
      economicExecutionEnabled = false;
    }
  } else {
    environment = "unavailable";
    economicExecutionEnabled = false;
  }

  return {
    purseAddress,
    isEnabled,
    environment,
    officialFennAvailable,
    officialBalanceFormatted,
    testBalanceFormatted,
    remainingBalanceFormatted,
    tokenDecimals,
    originalAllocationFormatted: PURSE_ORIGINAL_ALLOCATION_FORMATTED,
    totalTransferredFormatted: history.totalTransferredFormatted,
    totalBurnedFormatted: history.totalBurnedFormatted,
    largestTransferFormatted: history.largestTransferFormatted,
    largestBurnFormatted: history.largestBurnFormatted,
    rolling24hOutflowFormatted: history.rolling24hOutflowFormatted,
    confirmedTransferCount:
      history.confirmedTransferCount || transfers.length,
    confirmedBurnCount: history.confirmedBurnCount || burns.length,
    recentActions,
    economicExecutionEnabled,
    deadAddress: FENN_DEAD_ADDRESS,
    testRailExplicitlyActive,
    observedAt,
  };
}

/**
 * Prompt block for judges. Never exposes private keys.
 * Compact Purse scale + small history — not a financial dashboard.
 * Test rail is loudly labelled when active.
 */
export function formatPurseEconomicStateForPrompt(
  state: PurseEconomicState,
): string {
  const lines = [
    "=== TRUSTED PURSE STATE (THE PURSE) ===",
    `observed_at: ${state.observedAt}`,
    `purse_enabled: ${state.isEnabled}`,
    `purse_address: ${state.purseAddress ?? "(unconfigured)"}`,
    `environment: ${state.environment}`,
    `economic_execution_enabled: ${state.economicExecutionEnabled}`,
    `official_fenn_available: ${state.officialFennAvailable}`,
    "",
    "SCALE REFERENCE (orientation — not reward tiers):",
    `total_fenn_supply_assumption: ${FENN_TOTAL_SUPPLY_ASSUMPTION_FORMATTED}`,
    `original_purse_allocation: ${state.originalAllocationFormatted} FENN (1% of total supply assumption)`,
  ];

  if (state.testRailExplicitlyActive) {
    lines.push(
      "ECONOMIC TEST RAIL ACTIVE",
      "Asset is disposable test token.",
      "This is NOT official FENN.",
      `test_balance_remaining: ${state.testBalanceFormatted ?? "unavailable"}`,
    );
  } else {
    lines.push(
      `official_fenn_balance: ${state.officialBalanceFormatted ?? "unavailable"}`,
      `remaining_balance: ${state.remainingBalanceFormatted ?? "unavailable"}`,
    );
  }

  lines.push("scale_markers (of original Purse):");
  for (const ref of PURSE_SCALE_REFERENCES) {
    lines.push(
      `- ${ref.amountFormatted} FENN = ${ref.ofOriginalPurse} of original Purse`,
    );
  }
  lines.push(
    "Extremely tiny amounts relative to the original Purse may communicate almost nothing.",
    "Around 10,000 FENN (0.1% of original) is roughly the start of economically noticeable action — orientation, not a hard minimum.",
  );

  lines.push(
    "",
    "COMPACT HISTORY (trusted confirmed settlements):",
    `total_fenn_transferred: ${state.totalTransferredFormatted}`,
    `total_fenn_burned: ${state.totalBurnedFormatted}`,
    `largest_previous_transfer: ${state.largestTransferFormatted ?? "(none)"}`,
    `largest_previous_burn: ${state.largestBurnFormatted ?? "(none)"}`,
    `rolling_24h_economic_outflow: ${state.rolling24hOutflowFormatted}`,
    `confirmed_transfers: ${state.confirmedTransferCount}`,
    `confirmed_burns: ${state.confirmedBurnCount}`,
    `dead_address_for_burns: ${state.deadAddress} (server-owned; not model-chosen)`,
  );

  if (state.recentActions.length > 0) {
    lines.push("recent_confirmed_actions:");
    for (const a of state.recentActions.slice(0, 5)) {
      lines.push(
        `- ${a.actionType} amount=${a.amountFormatted} at ${a.confirmedAt} tx=${a.txHash.slice(0, 12)}…`,
      );
    }
  } else {
    lines.push("recent_confirmed_actions: (none)");
  }

  lines.push(
    "You propose magnitude via proposedAmount. Authority may permit or refuse exactly that amount — it will never silently reduce it.",
    "Do not invent balances. Do not claim a spend has completed.",
  );

  return lines.join("\n");
}

/** Exported for tests — format raw sum using token decimals without float. */
export function formatHistoryRawSum(
  rawSum: bigint,
  decimals: number,
): string {
  return formatRawToDecimalString(rawSum, decimals);
}
