/** UTC calendar helpers for Living Book daily coverage. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isUtcDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m! - 1 &&
    dt.getUTCDate() === d
  );
}

/** YYYY-MM-DD for the previous completed UTC calendar day. */
export function previousUtcCalendarDay(now: Date = new Date()): string {
  const utc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  utc.setUTCDate(utc.getUTCDate() - 1);
  return formatUtcDate(utc);
}

export function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** [start, end) ISO bounds for a UTC calendar day. */
export function utcDayBounds(coveredDate: string): {
  startIso: string;
  endIso: string;
} {
  if (!isUtcDateString(coveredDate)) {
    throw new Error(`Invalid UTC date: ${coveredDate}`);
  }
  const [y, m, d] = coveredDate.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, d!));
  const end = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** Display form: 28 JUL 2026 */
export function formatChronicleDateHeading(coveredDate: string): string {
  if (!isUtcDateString(coveredDate)) return coveredDate;
  const [y, m, d] = coveredDate.split("-").map(Number);
  const months = [
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
  ];
  return `${String(d).padStart(2, "0")} ${months[m! - 1]} ${y}`;
}
