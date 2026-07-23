import { formatUnits } from "viem";

import { TreasuryError } from "@/lib/treasury/errors";
import type { TreasuryAmount } from "@/lib/treasury/types";

/**
 * Build a TreasuryAmount from raw onchain units.
 * Uses viem formatUnits — no JS floating-point arithmetic.
 */
export function toTreasuryAmount(raw: bigint, decimals: number): TreasuryAmount {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new TreasuryError(
      "treasury_read_failed",
      "Invalid token decimals",
      500,
    );
  }
  return {
    raw,
    decimals,
    formatted: formatUnits(raw, decimals),
  };
}

/**
 * Parse a decimal string into raw bigint units without floating point.
 * Used for tests / exact fixtures — not for onchain reads.
 */
export function parseTokenAmountToRaw(
  formatted: string,
  decimals: number,
): bigint {
  const trimmed = formatted.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new TreasuryError(
      "treasury_read_failed",
      "Invalid token amount string",
      400,
    );
  }
  const [wholePart, fracPart = ""] = trimmed.split(".");
  if (fracPart.length > decimals) {
    throw new TreasuryError(
      "treasury_read_failed",
      "Token amount has too many fractional digits",
      400,
    );
  }
  const fracPadded = fracPart.padEnd(decimals, "0");
  const combined = `${wholePart}${fracPadded}`.replace(/^0+(?=\d)/, "") || "0";
  return BigInt(combined);
}
