/**
 * Ledger display helpers — UTC, register-like.
 */

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

/** `28 JUL 2026 · 11:42` (UTC). */
export function formatLedgerRecognitionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = MONTHS_UTC[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} · ${hh}:${mm}`;
}

export function formatLedgerLeafAmount(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-US");
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `-${formatted}`;
  return "0";
}

export function formatLedgerTotal(amount: number): string {
  return amount.toLocaleString("en-US");
}
