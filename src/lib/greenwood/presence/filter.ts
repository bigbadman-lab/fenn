import { GREENWOOD_FIRE_ACTIVE_TIMEOUT_MS } from "@/lib/greenwood/presence/constants";

/**
 * Pure presence activity check — timeout filtering is the authority.
 */
export function isFirePresenceActive(
  lastSeenAt: string | Date,
  nowMs: number = Date.now(),
  timeoutMs: number = GREENWOOD_FIRE_ACTIVE_TIMEOUT_MS,
): boolean {
  const seenMs =
    typeof lastSeenAt === "string"
      ? Date.parse(lastSeenAt)
      : lastSeenAt.getTime();
  if (!Number.isFinite(seenMs)) return false;
  return nowMs - seenMs <= timeoutMs;
}

/**
 * Sort Fire members: sitting first, then outlaw number ascending.
 * Self may appear anywhere; UI does not require a fixed self position.
 */
export function compareFirePresenceMembers(
  a: { sitting: boolean; outlawNumber: number },
  b: { sitting: boolean; outlawNumber: number },
): number {
  if (a.sitting !== b.sitting) return a.sitting ? -1 : 1;
  return a.outlawNumber - b.outlawNumber;
}
