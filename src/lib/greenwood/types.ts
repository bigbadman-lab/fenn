import type { SafeGreenwoodSigil } from "@/lib/greenwood/sigil/types";

export type GreenwoodMemberStatus = {
  state: "member";
  greenwoodEnteredAt: string;
  thresholdAtEntry: number;
  lifetimeLeafAtEntry: number;
  /** Current lifetime LEAF (standing continues to count). */
  currentLifetimeLeaf: number;
  /** 1-based deterministic rank among Greenwood members. */
  standingRank: number;
  /** Total Greenwood members included in the rank calculation. */
  standingTotalMembers: number;
  /** Persistent ASCII mark for The Fire. Null only if assignment failed. */
  sigil: SafeGreenwoodSigil | null;
  /**
   * True when the member has not yet completed the one-time arrival ceremony.
   * Existing/backfilled members are false.
   */
  arrivalCeremonyPending: boolean;
};

export type GreenwoodIneligibleStatus = {
  state: "ineligible";
  lifetimeLeaf: number;
  threshold: number;
  remainingLeaf: number;
  greenwoodEnteredAt: null;
};

export type GreenwoodEligibleStatus = {
  state: "eligible";
  lifetimeLeaf: number;
  threshold: number;
  remainingLeaf: 0;
  greenwoodEnteredAt: null;
};

/** Registered-profile Greenwood standing for Stage 8.3 gate wiring. */
export type GreenwoodStatus =
  | GreenwoodMemberStatus
  | GreenwoodIneligibleStatus
  | GreenwoodEligibleStatus;

export type GreenwoodAdmissionAdmitted = {
  status: "admitted";
  greenwoodEnteredAt: string;
  thresholdAtEntry: number;
  lifetimeLeafAtEntry: number;
  /**
   * Optional: if computed by the admission pipeline, it can be shown immediately.
   * Interior can also refresh via GET /api/greenwood/status.
   */
  currentLifetimeLeaf?: number;
  standingRank?: number;
  standingTotalMembers?: number;
  sigil?: SafeGreenwoodSigil | null;
  /** Newly admitted members always need the one-time arrival ceremony. */
  arrivalCeremonyPending: true;
};

export type GreenwoodAdmissionAlreadyMember = {
  status: "already_member";
  greenwoodEnteredAt: string;
  thresholdAtEntry: number;
  lifetimeLeafAtEntry: number;
  currentLifetimeLeaf?: number;
  standingRank?: number;
  standingTotalMembers?: number;
  sigil?: SafeGreenwoodSigil | null;
  /** True only if durable ceremony completion is still missing. */
  arrivalCeremonyPending: boolean;
};

export type GreenwoodAdmissionNotEligible = {
  status: "not_eligible";
  lifetimeLeaf: number;
  threshold: number;
  remainingLeaf: number;
};

/** Domain outcomes from Stage 8.1 admit_to_greenwood RPC. */
export type GreenwoodAdmissionResult =
  | GreenwoodAdmissionAdmitted
  | GreenwoodAdmissionAlreadyMember
  | GreenwoodAdmissionNotEligible;

export type AdmitToGreenwoodRpcRow = {
  status: string;
  newly_admitted: boolean;
  profile_id: string;
  lifetime_leaf: number | string;
  threshold: number | string;
  greenwood_entered_at: string | null;
  greenwood_threshold_at_entry: number | string | null;
  greenwood_lifetime_leaf_at_entry: number | string | null;
};
