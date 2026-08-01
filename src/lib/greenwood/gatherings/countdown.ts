/**
 * Pure countdown formatting for Gathering atmosphere.
 * Not permission authority — server state is.
 */

export function formatGatheringCountdown(
  targetIso: string,
  nowMs: number = Date.now(),
): { label: string; remainingMs: number; reached: boolean } {
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs)) {
    return { label: "", remainingMs: 0, reached: true };
  }
  const remainingMs = Math.max(0, targetMs - nowMs);
  const reached = remainingMs <= 0;
  if (reached) {
    return { label: "00:00:00", remainingMs: 0, reached: true };
  }

  const totalSec = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (days >= 1) {
    return {
      label: `${days}d ${pad(hours)}h`,
      remainingMs,
      reached: false,
    };
  }

  return {
    label: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
    remainingMs,
    reached: false,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
