/**
 * Deterministic enough relative labels; empty string when time invalid.
 * Prefer calling only after mount so SSR markup stays stable.
 */
export function formatClearingRelativeTime(
  iso: string,
  nowMs: number = Date.now(),
): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const deltaSec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (deltaSec < 45) return "now";
  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${days}d`;
}

export function formatClearingAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
