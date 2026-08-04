import type { GatheringAnnouncementStyle } from "@/lib/greenwood/gatherings/announcement-style";

export type GatheringAdminStatus =
  | "draft"
  | "scheduled"
  | "active"
  | "closed"
  | "cancelled";

/** Member-facing resolved lifecycle (server-time authority). */
export type GatheringResolvedState =
  | "draft"
  | "scheduled"
  | "active"
  | "closed"
  | "cancelled";

export type GatheringInteractionType = "raise_hand";

export type GatheringLocation = "fire";

export type GatheringRow = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  location: GatheringLocation;
  starts_at: string;
  ends_at: string;
  status: GatheringAdminStatus;
  interaction_type: GatheringInteractionType;
  capacity: number | null;
  reward_leaf_preview: number | null;
  linked_deed_id: string | null;
  created_by_actor_id: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  closed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type { GatheringAnnouncementStyle };

export type SafeGatheringDeedLink = {
  id: string;
  slug: string | null;
  title: string;
};

/** Member-safe Gathering projection. */
export type SafeGathering = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  location: GatheringLocation;
  startsAt: string;
  endsAt: string;
  resolvedState: GatheringResolvedState;
  interactionType: GatheringInteractionType;
  capacity: number | null;
  rewardLeafPreview: number | null;
  announcementStyle: GatheringAnnouncementStyle;
  handCount: number;
  memberHasRaisedHand: boolean;
  canRaiseHand: boolean;
  canLowerHand: boolean;
  linkedDeed: SafeGatheringDeedLink | null;
  serverNow: string;
};

export type FireGatheringsSnapshot = {
  active: SafeGathering | null;
  upcoming: SafeGathering | null;
  serverNow: string;
};

export type AdminGatheringListItem = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  location: GatheringLocation;
  startsAt: string;
  endsAt: string;
  status: GatheringAdminStatus;
  resolvedState: GatheringResolvedState;
  interactionType: GatheringInteractionType;
  capacity: number | null;
  rewardLeafPreview: number | null;
  linkedDeedId: string | null;
  announcementStyle: GatheringAnnouncementStyle;
  handCount: number;
  attendanceCount: number;
  cancelledAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminGatheringHandRow = {
  outlawLabel: string;
  displayName: string;
  raisedAt: string;
  loweredAt: string | null;
  isOpen: boolean;
};

export type AdminGatheringDetail = AdminGatheringListItem & {
  cancellationReason: string | null;
  createdByActorId: string;
  hands: AdminGatheringHandRow[];
  linkedDeed: SafeGatheringDeedLink | null;
  serverNow: string;
};
