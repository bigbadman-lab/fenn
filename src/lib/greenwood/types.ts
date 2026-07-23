export type GreenwoodMemberStatus = {
  state: "member";
  greenwoodEnteredAt: string;
  thresholdAtEntry: number;
  lifetimeLeafAtEntry: number;
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
};

export type GreenwoodAdmissionAlreadyMember = {
  status: "already_member";
  greenwoodEnteredAt: string;
  thresholdAtEntry: number;
  lifetimeLeafAtEntry: number;
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
