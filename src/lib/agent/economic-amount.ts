/**
 * Stage P1C — positive decimal-string token amounts for economic intent.
 * Never JS floating-point arithmetic on quantities.
 */

import { parseTokenAmountToRaw } from "@/lib/treasury/amounts";

/** Max fractional digits accepted at the judgement/schema boundary. */
export const ECONOMIC_PROPOSED_AMOUNT_MAX_FRACTIONAL_DIGITS = 18;

/**
 * Original Purse allocation for scale orientation (not a live inventory).
 * Calibration / constitution reference only.
 */
export const PURSE_ORIGINAL_ALLOCATION_FORMATTED = "10000000" as const;

/** Total supply assumption for calibration prose (not enforced on-chain). */
export const FENN_TOTAL_SUPPLY_ASSUMPTION_FORMATTED = "1000000000" as const;

/**
 * Scale reference points relative to the original 10M Purse.
 * Orientation for judgement — never tiers, entitlements, or automatic mappings.
 */
export const PURSE_SCALE_REFERENCES: readonly {
  amountFormatted: string;
  ofOriginalPurse: string;
}[] = [
  { amountFormatted: "10000", ofOriginalPurse: "0.1%" },
  { amountFormatted: "50000", ofOriginalPurse: "0.5%" },
  { amountFormatted: "100000", ofOriginalPurse: "1%" },
  { amountFormatted: "500000", ofOriginalPurse: "5%" },
  { amountFormatted: "1000000", ofOriginalPurse: "10%" },
] as const;

/**
 * Validate a model-proposed economic amount string.
 * Accepts positive decimal strings only (no exponent, sign, whitespace mid-number).
 * Returns the exact accepted string (trimmed) for fail-closed echo into effects.
 */
export function parseEconomicProposedAmount(
  raw: unknown,
  options?: { maxFractionalDigits?: number },
): string {
  if (typeof raw !== "string") {
    throw new Error("economic_amount_malformed");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("economic_amount_malformed");
  }
  // Explicit rejects for common non-decimal forms.
  if (/[eE+\s_]/.test(trimmed) || trimmed.includes(",")) {
    throw new Error("economic_amount_malformed");
  }
  if (trimmed.startsWith("-") || trimmed.startsWith("+")) {
    throw new Error("economic_amount_negative");
  }
  if (trimmed === "NaN" || trimmed === "Infinity" || trimmed === "-Infinity") {
    throw new Error("economic_amount_malformed");
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("economic_amount_malformed");
  }

  const [whole, frac = ""] = trimmed.split(".");
  const maxFrac =
    options?.maxFractionalDigits ?? ECONOMIC_PROPOSED_AMOUNT_MAX_FRACTIONAL_DIGITS;
  if (frac.length > maxFrac) {
    throw new Error("economic_amount_excessive_precision");
  }
  // Disallow empty whole (".5") — regex already requires leading digit.
  if (whole.length === 0) {
    throw new Error("economic_amount_malformed");
  }

  // Zero (including 0, 0.0, 0.00…) rejected.
  const allZero =
    /^0+$/.test(whole) && (frac.length === 0 || /^0+$/.test(frac));
  if (allZero) {
    throw new Error("economic_amount_zero");
  }

  return trimmed;
}

/** Compare two positive decimal strings as raw units (no float). */
export function compareEconomicAmountFormatted(
  a: string,
  b: string,
  decimals: number = ECONOMIC_PROPOSED_AMOUNT_MAX_FRACTIONAL_DIGITS,
): -1 | 0 | 1 {
  const rawA = parseTokenAmountToRaw(a, decimals);
  const rawB = parseTokenAmountToRaw(b, decimals);
  if (rawA < rawB) return -1;
  if (rawA > rawB) return 1;
  return 0;
}

export function isEconomicAmountPositiveAndAtMost(
  proposed: string,
  maximum: string,
  decimals: number = ECONOMIC_PROPOSED_AMOUNT_MAX_FRACTIONAL_DIGITS,
): boolean {
  return compareEconomicAmountFormatted(proposed, maximum, decimals) <= 0;
}

export function sumEconomicAmountFormatted(
  amounts: readonly string[],
  decimals: number = ECONOMIC_PROPOSED_AMOUNT_MAX_FRACTIONAL_DIGITS,
): string {
  let total = BigInt(0);
  for (const a of amounts) {
    total += parseTokenAmountToRaw(a, decimals);
  }
  return formatRawToDecimalString(total, decimals);
}

/**
 * Format raw units back to a decimal string without float math.
 * Trailing zeros in the fractional part are stripped; whole zeros kept as "0".
 */
export function formatRawToDecimalString(
  raw: bigint,
  decimals: number,
): string {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new Error("economic_amount_malformed");
  }
  if (raw < BigInt(0)) {
    throw new Error("economic_amount_negative");
  }
  if (decimals === 0) {
    return raw.toString();
  }
  const base = BigInt(10) ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  if (frac === BigInt(0)) {
    return whole.toString();
  }
  let fracStr = frac.toString().padStart(decimals, "0");
  fracStr = fracStr.replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}
