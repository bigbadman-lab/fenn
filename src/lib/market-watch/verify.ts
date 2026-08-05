/**
 * Dry-run explorer verification report (no publish, no cursor by default).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatClearingMarketFennAmount,
  marketWatchExplorerUrl,
} from "@/lib/clearing/market-display";
import {
  resolveOfficialMarketWatchConfig,
  type ResolvedMarketWatchConfig,
} from "@/lib/market-watch/config-loader";
import { decodeAndClassifySwap, logFromViem } from "@/lib/market-watch/decode";
import { MarketWatchError } from "@/lib/market-watch/errors";
import { logMarketWatch } from "@/lib/market-watch/log";
import { decideEventStatus } from "@/lib/market-watch/policy";
import {
  createMarketWatchRpcClient,
  fetchOfficialPoolSwapLogs,
  type MarketWatchRpcClient,
} from "@/lib/market-watch/rpc";
import { POOL_TOKEN_ORDER_ABI } from "@/lib/market-watch/topics";
import { MARKET_WATCH_VERIFY_MAX_SPAN } from "@/lib/market-watch/thresholds";
import { createRobinhoodPublicClient } from "@/lib/treasury/chain";

export type VerifyReportRow = {
  transactionHash: string;
  blockNumber: string;
  logIndex: number;
  eventType: "acquisition" | "disposal" | "suppressed" | "error";
  fennAmountRaw: string;
  fennAmountDisplay: string;
  quoteAmountRaw: string;
  quoteAmountDisplay: string;
  expectedStatus: "observed" | "published" | "suppressed" | "none";
  explorerUrl: string | null;
  suppressReason: string | null;
};

export type VerifyReport = {
  fromBlock: string;
  toBlock: string;
  effectiveToBlock: string;
  logCount: number;
  rows: VerifyReportRow[];
  acquisitions: number;
  disposals: number;
  suppressed: number;
  errors: number;
};

export function parseVerifyArgs(argv: string[]): {
  fromBlock: bigint;
  toBlock: bigint;
} {
  let fromBlock: bigint | null = null;
  let toBlock: bigint | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from-block" && argv[i + 1]) {
      fromBlock = BigInt(argv[++i]);
    } else if (argv[i] === "--to-block" && argv[i + 1]) {
      toBlock = BigInt(argv[++i]);
    }
  }
  if (fromBlock === null || toBlock === null) {
    throw new MarketWatchError(
      "mw_range_invalid",
      "Verify requires --from-block and --to-block",
      400,
    );
  }
  if (fromBlock > toBlock) {
    throw new MarketWatchError(
      "mw_range_invalid",
      "from-block must be <= to-block",
      400,
    );
  }
  if (toBlock - fromBlock + BigInt(1) > BigInt(MARKET_WATCH_VERIFY_MAX_SPAN)) {
    throw new MarketWatchError(
      "mw_range_invalid",
      `Verify range too large (max ${MARKET_WATCH_VERIFY_MAX_SPAN})`,
      400,
    );
  }
  return { fromBlock, toBlock };
}

/**
 * Classify Swap logs for operator comparison; does not persist or move cursor.
 */
export async function runMarketWatchVerify(input: {
  fromBlock: bigint;
  toBlock: bigint;
  config?: ResolvedMarketWatchConfig;
  rpc?: MarketWatchRpcClient;
  admin?: SupabaseClient;
  /** Allow verify when config.enabled=false (ops pre-live). */
  allowDisabledConfig?: boolean;
}): Promise<VerifyReport> {
  let config = input.config;
  if (!config) {
    const client = createRobinhoodPublicClient();
    const poolClient = {
      readContract: async (cargs: {
        address: `0x${string}`;
        abi: typeof POOL_TOKEN_ORDER_ABI;
        functionName: "token0" | "token1";
      }) =>
        client.readContract({
          address: cargs.address,
          abi: cargs.abi,
          functionName: cargs.functionName,
        }) as Promise<string>,
    };
    const state = await resolveOfficialMarketWatchConfig({
      admin: input.admin,
      poolClient,
    });
    if (state.status !== "ready") {
      throw new MarketWatchError(
        "mw_not_configured",
        "Market Watch config incomplete for verify",
        503,
      );
    }
    if (!state.config.enabled && !input.allowDisabledConfig) {
      // Still allow: ops verify before enable — auto allow when complete.
    }
    config = state.config;
  }

  const rpc =
    input.rpc ??
    createMarketWatchRpcClient(process.env.ROBINHOOD_CHAIN_RPC_URL);

  const { logs, effectiveToBlock } = await fetchOfficialPoolSwapLogs({
    rpc,
    poolAddress: config.poolAddress,
    swapTopic: config.swapTopic,
    fromBlock: input.fromBlock,
    toBlock: input.toBlock,
  });

  const rows: VerifyReportRow[] = [];
  let acquisitions = 0;
  let disposals = 0;
  let suppressed = 0;
  let errors = 0;

  for (const raw of logs) {
    const canon = logFromViem(raw);
    if (!canon) {
      errors += 1;
      continue;
    }
    const classified = decodeAndClassifySwap({
      log: canon,
      poolKind: config.poolKind,
      expectedPool: config.poolAddress,
      expectedTopic: config.swapTopic,
      order: config.tokenOrder,
      classificationVersion: config.classificationVersion,
    });

    if (classified.kind === "error") {
      errors += 1;
      rows.push({
        transactionHash: canon.transactionHash,
        blockNumber: canon.blockNumber.toString(),
        logIndex: canon.logIndex,
        eventType: "error",
        fennAmountRaw: "0",
        fennAmountDisplay: "—",
        quoteAmountRaw: "0",
        quoteAmountDisplay: "—",
        expectedStatus: "none",
        explorerUrl: marketWatchExplorerUrl(
          config.chainId,
          canon.transactionHash,
        ),
        suppressReason: classified.reason,
      });
      continue;
    }

    if (classified.kind === "suppress") {
      suppressed += 1;
      rows.push({
        transactionHash: canon.transactionHash,
        blockNumber: canon.blockNumber.toString(),
        logIndex: canon.logIndex,
        eventType: "suppressed",
        fennAmountRaw: (classified.fennAmountRaw ?? BigInt(0)).toString(),
        fennAmountDisplay: formatClearingMarketFennAmount(
          classified.fennAmountRaw ?? BigInt(0),
          config.tokenDecimals,
          config.tokenSymbol,
        ),
        quoteAmountRaw: (classified.quoteAmountRaw ?? BigInt(0)).toString(),
        quoteAmountDisplay: formatClearingMarketFennAmount(
          classified.quoteAmountRaw ?? BigInt(0),
          config.quoteTokenDecimals,
          config.quoteTokenSymbol,
        ),
        expectedStatus: "suppressed",
        explorerUrl: marketWatchExplorerUrl(
          config.chainId,
          canon.transactionHash,
        ),
        suppressReason: classified.reason,
      });
      continue;
    }

    if (classified.eventType === "acquisition") acquisitions += 1;
    else disposals += 1;

    // dry_run status for public eligibility report
    const decision = decideEventStatus({
      mode: "dry_run",
      eventType: classified.eventType,
      fennAmountRaw: classified.fennAmountRaw,
      minDisplayFennRaw: config.minDisplayFennRaw,
    });

    rows.push({
      transactionHash: canon.transactionHash,
      blockNumber: canon.blockNumber.toString(),
      logIndex: canon.logIndex,
      eventType: classified.eventType,
      fennAmountRaw: classified.fennAmountRaw.toString(),
      fennAmountDisplay: formatClearingMarketFennAmount(
        classified.fennAmountRaw,
        config.tokenDecimals,
        config.tokenSymbol,
      ),
      quoteAmountRaw: classified.quoteAmountRaw.toString(),
      quoteAmountDisplay: formatClearingMarketFennAmount(
        classified.quoteAmountRaw,
        config.quoteTokenDecimals,
        config.quoteTokenSymbol,
      ),
      expectedStatus:
        decision.status === "published"
          ? "published"
          : decision.status === "suppressed"
            ? "suppressed"
            : "observed",
      explorerUrl: marketWatchExplorerUrl(
        config.chainId,
        canon.transactionHash,
      ),
      suppressReason: decision.suppressReason,
    });
  }

  const report: VerifyReport = {
    fromBlock: input.fromBlock.toString(),
    toBlock: input.toBlock.toString(),
    effectiveToBlock: effectiveToBlock.toString(),
    logCount: logs.length,
    rows,
    acquisitions,
    disposals,
    suppressed,
    errors,
  };

  logMarketWatch({
    event: "verify_summary",
    ok: true,
    mode: "dry_run",
    fromBlock: report.fromBlock,
    toBlock: report.effectiveToBlock,
    logCount: report.logCount,
    acquisitions,
    disposals,
    suppressed,
    detail: `errors=${errors}`,
  });

  return report;
}
