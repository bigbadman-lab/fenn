/** Client-safe Outlaw Invite DTOs. */

export type OutlawInviteMemberSummary = {
  inviteCode: string;
  inviteUrl: string;
  rewardPerInvite: 5;
  rewardCap: 10;
  registeredInviteCount: number;
  rewardedInviteCount: number;
  inviteLeafGranted: number;
  rewardedInvitesRemaining: number;
  recentArrivals: OutlawInviteRecentArrival[];
};

export type OutlawInviteRecentArrival = {
  outlawLabel: string;
  arrivedAt: string;
  rewarded: boolean;
};

export type OutlawInviteCaptureResult = {
  valid: boolean;
  /** Safe public Outlaw label only — no private identity fields. */
  inviterLabel: string | null;
};

export type OutlawInviteRegisterOutcome =
  | "rewarded"
  | "cap_reached"
  | "already_attributed"
  | "already_rewarded"
  | "invalid_code"
  | "rejected_self"
  | "skipped"
  | "failed";

export type DeskInviteSummary = {
  registeredInviteCount: number;
  rewardedInviteCount: number;
  inviteLeafGranted: number;
  rewardedInvitesRemaining: number;
  recentArrivals: OutlawInviteRecentArrival[];
};
