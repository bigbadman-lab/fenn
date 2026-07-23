import type { PublicTreasuryAssetRead } from "@/lib/treasury/types";

const MONTHS_UTC = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

/**
 * Restrained freshness line from Treasury `observedAt`.
 * Not realtime — observation time of the server read.
 */
export function formatTreasuryObservedAt(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `last seen ${hh}:${mm} UTC`;
}

/**
 * Deterministic UTC date for Commons history: `23 JUL 2026`.
 */
export function formatCommonsHistoryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = MONTHS_UTC[d.getUTCMonth()];
  return `${day} ${month} ${d.getUTCFullYear()}`;
}

/**
 * Display signed commitment delta as exact string.
 * Adds a leading `+` for unsigned positives. Never uses Number().
 */
export function formatCommitmentDelta(deltaAmount: string): string {
  const trimmed = deltaAmount.trim();
  if (trimmed.startsWith("-") || trimmed.startsWith("+")) {
    return trimmed;
  }
  return `+${trimmed}`;
}

/**
 * User-facing Treasury asset balance label.
 * Known zero stays `"0"` / API formatted zero. Unavailable is never zero.
 */
export function treasuryAssetBalanceDisplay(
  asset: PublicTreasuryAssetRead,
): { kind: "balance"; value: string } | { kind: "unavailable"; value: string } {
  if (asset.state === "available") {
    return { kind: "balance", value: asset.balance };
  }
  return { kind: "unavailable", value: "unseen." };
}
