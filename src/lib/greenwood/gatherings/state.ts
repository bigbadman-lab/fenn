import type {
  GatheringAdminStatus,
  GatheringResolvedState,
  GatheringRow,
} from "@/lib/greenwood/gatherings/types";

/**
 * Central Gathering lifecycle resolver.
 * Server time is mandatory authority — never trust client clocks.
 */
export function resolveGatheringState(
  input: {
    status: GatheringAdminStatus;
    startsAt: string | Date;
    endsAt: string | Date;
    cancelledAt?: string | Date | null;
    closedAt?: string | Date | null;
  },
  nowMs: number = Date.now(),
): GatheringResolvedState {
  if (input.status === "cancelled" || input.cancelledAt != null) {
    return "cancelled";
  }
  if (input.status === "draft") {
    return "draft";
  }
  if (input.status === "closed" || input.closedAt != null) {
    return "closed";
  }

  // Published: scheduled | active (persisted active still re-derived from time)
  if (input.status === "scheduled" || input.status === "active") {
    const startsMs = toMs(input.startsAt);
    const endsMs = toMs(input.endsAt);
    if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs)) {
      return "closed";
    }
    if (nowMs < startsMs) return "scheduled";
    if (nowMs >= endsMs) return "closed";
    return "active";
  }

  return "closed";
}

export function resolveGatheringStateFromRow(
  row: Pick<
    GatheringRow,
    "status" | "starts_at" | "ends_at" | "cancelled_at" | "closed_at"
  >,
  nowMs: number = Date.now(),
): GatheringResolvedState {
  return resolveGatheringState(
    {
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      cancelledAt: row.cancelled_at,
      closedAt: row.closed_at,
    },
    nowMs,
  );
}

export function isMemberVisibleState(
  state: GatheringResolvedState,
): boolean {
  return (
    state === "scheduled" ||
    state === "active" ||
    state === "closed" ||
    state === "cancelled"
  );
}

/** Ranges overlap on half-open [start, end). */
export function gatheringWindowsOverlap(
  a: { startsAt: string | Date; endsAt: string | Date },
  b: { startsAt: string | Date; endsAt: string | Date },
): boolean {
  const a0 = toMs(a.startsAt);
  const a1 = toMs(a.endsAt);
  const b0 = toMs(b.startsAt);
  const b1 = toMs(b.endsAt);
  if (![a0, a1, b0, b1].every(Number.isFinite)) return false;
  return a0 < b1 && b0 < a1;
}

function toMs(value: string | Date): number {
  return typeof value === "string" ? Date.parse(value) : value.getTime();
}
