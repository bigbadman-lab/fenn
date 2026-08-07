/** Client-safe pure helpers for ticker display (no server IO). */

export function collapseWs(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function formatTickerClock(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "——:——";
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
