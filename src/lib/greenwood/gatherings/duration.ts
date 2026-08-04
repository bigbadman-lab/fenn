/**
 * Duration validation for duration-based Desk "Begin Gathering".
 */

export const GATHERING_DURATION_MIN_MINUTES = 5;
export const GATHERING_DURATION_MAX_MINUTES = 720;
export const GATHERING_DURATION_PRESETS = [15, 30, 60, 90] as const;

export type GatheringDurationPreset =
  | (typeof GATHERING_DURATION_PRESETS)[number]
  | "custom";

export function isValidGatheringDurationMinutes(
  value: unknown,
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (!Number.isInteger(value)) return false;
  return (
    value >= GATHERING_DURATION_MIN_MINUTES &&
    value <= GATHERING_DURATION_MAX_MINUTES
  );
}

export function formatDurationMinutesLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return hours === 1 ? "1 hour" : `${hours} hours`;
  return `${hours}h ${rem}m`;
}

/** Minutes between ISO timestamps (rounded). */
export function durationMinutesBetween(
  startsAt: string,
  endsAt: string,
): number | null {
  const s = Date.parse(startsAt);
  const e = Date.parse(endsAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  return Math.max(1, Math.round((e - s) / 60_000));
}

/**
 * Human remaining time without second noise for Keeper/banner copy.
 */
export function formatRemainingDurationLabel(
  remainingMs: number,
): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "0 minutes";
  const totalMin = Math.max(1, Math.ceil(remainingMs / 60_000));
  if (totalMin < 60) {
    return totalMin === 1 ? "1 minute" : `${totalMin} minutes`;
  }
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (mins === 0) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return `${hours}h ${mins}m`;
}

export function formatBeginsInLabel(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "now";
  const totalMin = Math.max(1, Math.ceil(remainingMs / 60_000));
  if (totalMin < 60) {
    return totalMin === 1 ? "1 minute" : `${totalMin} minutes`;
  }
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (mins === 0) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  if (totalMin < 24 * 60) {
    return `${hours}h ${mins}m`;
  }
  const days = Math.floor(totalMin / (24 * 60));
  const remHours = Math.floor((totalMin % (24 * 60)) / 60);
  if (remHours === 0) {
    return days === 1 ? "1 day" : `${days} days`;
  }
  return `${days}d ${remHours}h`;
}
