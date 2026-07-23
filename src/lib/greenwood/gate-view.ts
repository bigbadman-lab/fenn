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
  };
}

/**
 * Map GET /api/greenwood/status payload into a gate view + data.
 * Does not invent eligibility — server state is authoritative.
 */
export function viewFromGreenwoodStatus(status: GreenwoodStatus): {
  view: "ineligible" | "eligible" | "member";
  standing?: GreenwoodStandingView;
  member?: GreenwoodMemberSnapshotView;
} {
  if (status.state === "member") {
    return {
      view: "member",
      member: memberSnapshotFromStatus(status),
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
 * already_member is success. not_eligible returns to refusal with server numbers.
 */
export function viewFromAdmissionResult(result: GreenwoodAdmissionResult): {
  view: "member" | "ineligible";
  standing?: GreenwoodStandingView;
  member?: GreenwoodMemberSnapshotView;
} {
  if (result.status === "admitted" || result.status === "already_member") {
    return {
      view: "member",
      member: {
        greenwoodEnteredAt: result.greenwoodEnteredAt,
        thresholdAtEntry: result.thresholdAtEntry,
        lifetimeLeafAtEntry: result.lifetimeLeafAtEntry,
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
