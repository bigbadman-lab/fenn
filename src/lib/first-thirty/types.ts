/**
 * THE FIRST THIRTY — constants, safe DTOs, pure helpers.
 * Does not write LEAF; progress mutations are SQL RPCs only.
 */

export const FIRST_THIRTY_NOMINAL_GRANT = 10;

export const FIRST_THIRTY_MILESTONES = [
  "camp_first",
  "camp_three",
  "first_deed",
] as const;

export type FirstThirtyMilestone = (typeof FIRST_THIRTY_MILESTONES)[number];

export type FirstThirtyNextMilestone =
  | "first_camp"
  | "third_camp"
  | "first_deed"
  | null;

/** In-world acknowledgements only when actualGrant path still separate. */
export const FIRST_THIRTY_ACK = {
  camp_first: "THE FIRE LEFT SOMETHING BEHIND",
  camp_three: "THE GREENWOOD REMEMBERED",
  first_deed: "THE GREENWOOD OPENS",
} as const;

export type FirstThirtyMilestoneEvent = {
  milestone: FirstThirtyMilestone;
  newlySatisfied: boolean;
  /** Always nominal 10 when newly satisfied; not LEAF claimed. */
  nominalGrant: number;
  /** Actual leaf_ledger insert amount (may be 0). */
  actualGrant: number;
  greenwoodOpen: boolean;
};

/** Per-milestone onboarding LEAF actually written (may be less than nominal 10). */
export type FirstThirtyMilestoneGrants = {
  firstCamp: number;
  thirdCamp: number;
  firstDeed: number;
};

/** Client-safe progression snapshot. No scores or internal UUIDs. */
export type SafeFirstThirtyProgress = {
  active: boolean;
  completed: boolean;
  terminated: boolean;
  greenwoodOpen: boolean;
  eligibleCampExchanges: number;
  milestones: {
    firstCamp: boolean;
    thirdCamp: boolean;
    firstDeed: boolean;
  };
  /**
   * Trusted actual onboarding grants per milestone when a progress row exists.
   * Omitted on pure unstarted derivation (all zeroes implied).
   */
  milestoneGrants?: FirstThirtyMilestoneGrants;
  /** Sum of onboarding LEAF actually granted (ledger-backed counts only). */
  milestoneLeafGranted: number;
  lifetimeLeaf: number;
  leafUntilGreenwood: number;
  nextMilestone: FirstThirtyNextMilestone;
  /** Present only when a response just satisfied a milestone. */
  lastEvent?: FirstThirtyMilestoneEvent;
  /**
   * Set only on CAMP turn responses: this assistant exchange was counted
   * as eligible. Omitted on read-only progress fetches.
   */
  exchangeCounted?: boolean;
};

export type FirstThirtyProgressRow = {
  profile_id: string;
  status: "active" | "completed" | "terminated";
  eligible_camp_exchange_count: number;
  first_camp_satisfied_at: string | null;
  third_camp_satisfied_at: string | null;
  first_deed_satisfied_at: string | null;
  first_camp_leaf_granted: number;
  third_camp_leaf_granted: number;
  first_deed_leaf_granted: number;
  onboarding_leaf_granted: number;
  finished_reason: string | null;
};

/** Ordinary CAMP grants are suppressed only while this is true. */
export function isFirstThirtySuppressingCamp(
  progress: Pick<SafeFirstThirtyProgress, "active"> | null | undefined,
): boolean {
  return Boolean(progress?.active);
}

export function nextMilestoneFromFlags(input: {
  active: boolean;
  firstCamp: boolean;
  thirdCamp: boolean;
  firstDeed: boolean;
}): FirstThirtyNextMilestone {
  if (!input.active) return null;
  if (!input.firstCamp) return "first_camp";
  if (!input.thirdCamp) return "third_camp";
  if (!input.firstDeed) return "first_deed";
  return null;
}

/**
 * Pure derivation for unstarted profiles — no DB row required.
 */
export function buildUnstartedFirstThirtyProgress(input: {
  lifetimeLeaf: number;
  greenwoodThreshold: number;
  isGreenwoodMember: boolean;
}): SafeFirstThirtyProgress {
  const lifetimeLeaf = Math.max(0, Math.trunc(input.lifetimeLeaf));
  const threshold = Math.max(0, Math.trunc(input.greenwoodThreshold));
  const greenwoodOpen =
    input.isGreenwoodMember || lifetimeLeaf >= threshold;
  const finished = greenwoodOpen;

  return {
    active: !finished,
    completed: false,
    terminated: finished,
    greenwoodOpen,
    eligibleCampExchanges: 0,
    milestones: {
      firstCamp: false,
      thirdCamp: false,
      firstDeed: false,
    },
    milestoneLeafGranted: 0,
    lifetimeLeaf,
    leafUntilGreenwood: Math.max(0, threshold - lifetimeLeaf),
    nextMilestone: finished ? null : "first_camp",
  };
}

export function progressFromRow(input: {
  row: FirstThirtyProgressRow;
  lifetimeLeaf: number;
  greenwoodThreshold: number;
  isGreenwoodMember: boolean;
  lastEvent?: FirstThirtyMilestoneEvent;
}): SafeFirstThirtyProgress {
  const lifetimeLeaf = Math.max(0, Math.trunc(input.lifetimeLeaf));
  const threshold = Math.max(0, Math.trunc(input.greenwoodThreshold));
  const greenwoodOpen =
    input.isGreenwoodMember || lifetimeLeaf >= threshold;
  const active = input.row.status === "active" && !greenwoodOpen;
  // If greenwood opened but row still active, treat as finished for clients.
  const completed = input.row.status === "completed" || (greenwoodOpen && input.row.status === "active" && allMilestones(input.row));
  const terminated =
    input.row.status === "terminated" ||
    (greenwoodOpen && input.row.status === "active" && !allMilestones(input.row));

  const firstCamp = input.row.first_camp_satisfied_at != null;
  const thirdCamp = input.row.third_camp_satisfied_at != null;
  const firstDeed = input.row.first_deed_satisfied_at != null;

  const effectiveActive = active && !greenwoodOpen;

  return {
    active: effectiveActive,
    completed: completed || (greenwoodOpen && allMilestones(input.row)),
    terminated: !effectiveActive && !completed && (terminated || greenwoodOpen),
    greenwoodOpen,
    eligibleCampExchanges: Math.max(
      0,
      Math.trunc(input.row.eligible_camp_exchange_count),
    ),
    milestones: { firstCamp, thirdCamp, firstDeed },
    milestoneGrants: {
      firstCamp: Math.max(0, Math.trunc(input.row.first_camp_leaf_granted)),
      thirdCamp: Math.max(0, Math.trunc(input.row.third_camp_leaf_granted)),
      firstDeed: Math.max(0, Math.trunc(input.row.first_deed_leaf_granted)),
    },
    milestoneLeafGranted: Math.max(
      0,
      Math.trunc(input.row.onboarding_leaf_granted),
    ),
    lifetimeLeaf,
    leafUntilGreenwood: Math.max(0, threshold - lifetimeLeaf),
    nextMilestone: nextMilestoneFromFlags({
      active: effectiveActive,
      firstCamp,
      thirdCamp,
      firstDeed,
    }),
    ...(input.lastEvent ? { lastEvent: input.lastEvent } : {}),
  };
}

function allMilestones(row: FirstThirtyProgressRow): boolean {
  return (
    row.first_camp_satisfied_at != null &&
    row.third_camp_satisfied_at != null &&
    row.first_deed_satisfied_at != null
  );
}

export function mapRpcMilestone(
  raw: string | null | undefined,
): FirstThirtyMilestone | null {
  if (raw === "camp_first" || raw === "camp_three" || raw === "first_deed") {
    return raw;
  }
  return null;
}
