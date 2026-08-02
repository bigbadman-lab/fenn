import type {
  GatheringAdminStatus,
  GatheringResolvedState,
  SafeGatheringDeedLink,
} from "@/lib/greenwood/gatherings/types";

export type DeskGatheringListItem = {
  id: string;
  title: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  status: GatheringAdminStatus;
  resolvedState: GatheringResolvedState;
  capacity: number | null;
  rewardLeafPreview: number | null;
  linkedDeedId: string | null;
  handCount: number;
  attendanceCount: number;
  cancelledAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rewardCampaign: {
    id: string;
    title: string;
    status: string;
  } | null;
};

export type DeskGatheringHand = {
  profileId: string;
  displayName: string;
  outlawNumberLabel: string;
  sigil: { asciiBody: string; a11yLabel: string } | null;
  raisedAt: string;
  loweredAt: string | null;
  isOpen: boolean;
  attended: boolean;
  firstAttendedAt: string | null;
};

export type DeskGatheringDetail = DeskGatheringListItem & {
  cancellationReason: string | null;
  linkedDeed: SafeGatheringDeedLink | null;
  hands: DeskGatheringHand[];
  openHandCount: number;
  loweredHandCount: number;
  serverNow: string;
};

export type DeskGatheringFilter =
  | "all"
  | "draft"
  | "upcoming"
  | "active"
  | "closed"
  | "cancelled"
  | "closed_hands_no_campaign";
