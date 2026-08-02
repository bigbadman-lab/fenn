import type { SafeGreenwoodSigil } from "@/lib/greenwood/sigil/types";
import type {
  GreenwoodAdmissionResult,
  GreenwoodEligibleStatus,
  GreenwoodIneligibleStatus,
  GreenwoodMemberStatus,
  GreenwoodStatus,
} from "@/lib/greenwood/types";

/** Client-side gate presentation states for Stage 8.3. */
export type GreenwoodGateView =
  | "auth"
  | "registration"
  | "loading"
  | "ineligible"
  | "eligible"
  | "entering"
  | "member"
  | "interior"
  | "status_error"
  | "enter_error";

export type GreenwoodStandingView = {
  lifetimeLeaf: number;
  threshold: number;
  remainingLeaf: number;
};

export type GreenwoodMemberSnapshotView = {
  greenwoodEnteredAt: string;
  thresholdAtEntry: number;
  lifetimeLeafAtEntry: number;
  /** Current lifetime LEAF (may be refreshed after first-entry transition). */
  currentLifetimeLeaf?: number;
  /** Deterministic rank among Greenwood members (may be refreshed after transition). */
  standingRank?: number;
  /** Total Greenwood members included in the rank calculation. */
  standingTotalMembers?: number;
  /** Persistent ASCII mark (may be null if assignment failed). */
  sigil?: SafeGreenwoodSigil | null;
  /** True when the one-time arrival ceremony has not been durably completed. */
  arrivalCeremonyPending?: boolean;
};

/** Auth / registration branch before Greenwood status is consulted. */
export function resolveAuthGateBranch(input: {
  authenticated: boolean;
  registered: boolean;
}): "login" | "register" | "status" {
  if (!input.authenticated) return "login";
  if (!input.registered) return "register";
  return "status";
}

export function standingFromStatus(
  status: GreenwoodIneligibleStatus | GreenwoodEligibleStatus,
): GreenwoodStandingView {
  return {
    lifetimeLeaf: status.lifetimeLeaf,
    threshold: status.threshold,
    remainingLeaf: status.remainingLeaf,
  };
}

export function memberSnapshotFromStatus(
  status: GreenwoodMemberStatus,
): GreenwoodMemberSnapshotView {
  return {
    greenwoodEnteredAt: status.greenwoodEnteredAt,
    thresholdAtEntry: status.thresholdAtEntry,
    lifetimeLeafAtEntry: status.lifetimeLeafAtEntry,
    currentLifetimeLeaf: status.currentLifetimeLeaf,
    standingRank: status.standingRank,
    standingTotalMembers: status.standingTotalMembers,
    sigil: status.sigil,
    arrivalCeremonyPending: status.arrivalCeremonyPending,
  };
}

/**
 * Map GET /api/greenwood/status payload into a gate view + data.
 * Returning members (ceremony complete) go straight to the interior.
 * Members with a pending arrival ceremony see the one-time ceremony.
 * Does not invent eligibility — server state is authoritative.
 */
export function viewFromGreenwoodStatus(status: GreenwoodStatus): {
  view: "ineligible" | "eligible" | "member" | "interior";
  standing?: GreenwoodStandingView;
  member?: GreenwoodMemberSnapshotView;
} {
  if (status.state === "member") {
    const member = memberSnapshotFromStatus(status);
    return {
      view: status.arrivalCeremonyPending ? "member" : "interior",
      member,
    };
  }
  if (status.state === "eligible") {
    return {
      view: "eligible",
      standing: standingFromStatus(status),
    };
  }
  return {
    view: "ineligible",
    standing: standingFromStatus(status),
  };
}

/**
 * Map POST /api/greenwood/enter domain result.
 * admitted → arrival ceremony. already_member → ceremony if pending, else interior.
 * not_eligible returns to refusal with server numbers.
 */
export function viewFromAdmissionResult(result: GreenwoodAdmissionResult): {
  view: "member" | "interior" | "ineligible";
  standing?: GreenwoodStandingView;
  member?: GreenwoodMemberSnapshotView;
} {
  if (result.status === "admitted") {
    return {
      view: "member",
      member: {
        greenwoodEnteredAt: result.greenwoodEnteredAt,
        thresholdAtEntry: result.thresholdAtEntry,
        lifetimeLeafAtEntry: result.lifetimeLeafAtEntry,
        currentLifetimeLeaf: result.currentLifetimeLeaf,
        standingRank: result.standingRank,
        standingTotalMembers: result.standingTotalMembers,
        sigil: result.sigil,
        arrivalCeremonyPending: true,
      },
    };
  }

  if (result.status === "already_member") {
    const pending = result.arrivalCeremonyPending;
    return {
      view: pending ? "member" : "interior",
      member: {
        greenwoodEnteredAt: result.greenwoodEnteredAt,
        thresholdAtEntry: result.thresholdAtEntry,
        lifetimeLeafAtEntry: result.lifetimeLeafAtEntry,
        currentLifetimeLeaf: result.currentLifetimeLeaf,
        standingRank: result.standingRank,
        standingTotalMembers: result.standingTotalMembers,
        sigil: result.sigil,
        arrivalCeremonyPending: pending,
      },
    };
  }

  return {
    view: "ineligible",
    standing: {
      lifetimeLeaf: result.lifetimeLeaf,
      threshold: result.threshold,
      remainingLeaf: result.remainingLeaf,
    },
  };
}

/** Eligible ENTER must not fire while a request is already in flight. */
export function canSubmitGreenwoodEnter(view: GreenwoodGateView): boolean {
  return view === "eligible" || view === "enter_error";
}
