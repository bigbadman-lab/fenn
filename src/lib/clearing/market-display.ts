/**
 * Server-safe formatting for Clearing system events (Market Watch acquisitions).
 * Raw amounts stay as integer strings; never float arithmetic.
 */

import { toTreasuryAmount } from "@/lib/treasury/amounts";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { explorerTxUrl } from "@/lib/greenwood/hollow/explorer";

/** Canonical world-event heading for all system posts in The Clearing. */
export const CLEARING_WOOD_NOTICES_HEADING = "THE WOOD NOTICES";

export const CLEARING_WOOD_NOTICES_LEAD = "A wallet entered";

/**
 * Format a decimal string from formatUnits with thousands separators on the
 * integer part. Never converts through Number for the full magnitude.
 */
export function formatTokenAmountWithSeparators(formattedUnits: string): string {
  const trimmed = formattedUnits.trim();
  if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return "0";
  }
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw, fracRaw] = body.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let out = withCommas;
  if (fracRaw && /[1-9]/.test(fracRaw)) {
    // Trim trailing zeros from fractional display only.
    const frac = fracRaw.replace(/0+$/, "");
    if (frac) out = `${withCommas}.${frac}`;
  }
  return negative ? `-${out}` : out;
}

/**
 * Public label: `18,420 $FENN`
 */
export function formatClearingMarketFennAmount(
  raw: string | bigint,
  decimals: number,
  symbol = "FENN",
): string {
  let rawBig: bigint;
  try {
    rawBig = typeof raw === "bigint" ? raw : BigInt(String(raw).trim());
  } catch {
    return `0 $${symbol}`;
  }
  if (rawBig < BigInt(0)) {
    return `0 $${symbol}`;
  }
  const amount = toTreasuryAmount(rawBig, decimals);
  const display = formatTokenAmountWithSeparators(amount.formatted);
  const sym = symbol.trim() || "FENN";
  return `${display} $${sym}`;
}

export function marketWatchExplorerUrl(
  chainId: number,
  transactionHash: string,
): string | null {
  return explorerTxUrl(chainId || ROBINHOOD_CHAIN_ID, transactionHash);
}
