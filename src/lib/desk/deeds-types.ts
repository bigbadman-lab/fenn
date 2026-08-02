import type { DeedAccessScope, DeedReward } from "@/lib/deeds/types";

export type DeskDeedStatusFilter = "pending" | "approved" | "rejected" | "all";
export type DeskDeedSort = "oldest" | "newest";
export type DeskDeedEvidenceFilter =
  | "all"
  | "image"
  | "url"
  | "text"
  | "other";

export type DeskDeedListItem = {
  submissionId: string;
  deedId: string;
  deedTitle: string;
  deedSlug: string | null;
  profileId: string;
  outlawLabel: string;
  displayName: string;
  sigil: { asciiBody: string; a11yLabel: string } | null;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  reward: DeedReward;
  rewardLabel: string;
  accessScope: DeedAccessScope;
  greenwoodOnly: boolean;
  isRepeatable: boolean;
  hasImageEvidence: boolean;
  evidenceTypes: string[];
  requiresEvidenceReview: boolean;
  ageLabel: string;
};

export type DeskDeedListPage = {
  submissions: DeskDeedListItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export type DeskDeedDetail = DeskDeedListItem & {
  deedDescription: string;
  deedInstructions: string;
  evidenceRequirements: {
    text: { allowed: boolean; required: boolean };
    url: { allowed: boolean; required: boolean };
    image: { allowed: boolean; required: boolean };
    other: { allowed: boolean; required: boolean };
  };
  evidenceText: string | null;
  evidenceUrl: string | null;
  evidenceOther: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  leafAwarded: number | null;
  startsAt: string | null;
  endsAt: string | null;
  rewardPreview: {
    kind: "fixed" | "range" | "none";
    fixedAmount: number | null;
    min: number | null;
    max: number | null;
    expectedSource: "deed_approval";
  };
};
