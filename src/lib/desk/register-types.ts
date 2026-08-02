/** Client-safe Desk Register DTOs. */

export type DeskPresenceState =
  | "at_the_fire"
  | "sitting"
  | "recently_warm"
  | "not_present";

export type DeskRegisterMemberListItem = {
  profileId: string;
  outlawNumber: number;
  outlawNumberLabel: string;
  displayName: string;
  walletAddress: string;
  walletShort: string;
  xHandle: string | null;
  joinedAt: string;
  leafBalance: number;
  leafLifetimeEarned: number;
  standingLabel: string;
  greenwoodMember: boolean;
  greenwoodEnteredAt: string | null;
  sigil: {
    asciiBody: string;
    a11yLabel: string;
  } | null;
  presence: DeskPresenceState;
  pendingDeedCount: number;
  explorerUrl: string | null;
};

export type DeskRegisterListPage = {
  members: DeskRegisterMemberListItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export type DeskRegisterDeedActivity = {
  submissionId: string;
  deedTitle: string;
  status: string;
  submittedAt: string;
  leafAwarded: number | null;
};

export type DeskRegisterGatheringActivity = {
  gatheringId: string;
  title: string;
  raisedAt: string;
  loweredAt: string | null;
  handOpen: boolean;
};

export type DeskRegisterHollowActivity = {
  rewardId: string;
  title: string;
  rewardType: string;
  amount: number | null;
  status: string;
  transactionHash: string | null;
};

export type DeskRegisterLedgerActivity = {
  id: string;
  amount: number;
  sourceType: string;
  reason: string;
  createdAt: string;
};

export type DeskRegisterCampSummary = {
  sessionCount: number;
  lastMessageAt: string | null;
  totalMessages: number;
};

export type DeskRegisterMemberDetail = {
  profileId: string;
  outlawNumber: number;
  outlawNumberLabel: string;
  displayName: string;
  walletAddress: string;
  walletShort: string;
  explorerUrl: string | null;
  xHandle: string | null;
  joinedAt: string;
  leafBalance: number;
  leafLifetimeEarned: number;
  standingLabel: string;
  greenwoodThreshold: number | null;
  meetsGreenwoodThreshold: boolean | null;
  greenwoodMember: boolean;
  greenwoodEnteredAt: string | null;
  sigil: {
    asciiBody: string;
    a11yLabel: string;
    slug: string;
  } | null;
  presence: DeskPresenceState;
  recentDeeds: DeskRegisterDeedActivity[];
  recentGatheringHands: DeskRegisterGatheringActivity[];
  recentHollow: DeskRegisterHollowActivity[];
  recentLedger: DeskRegisterLedgerActivity[];
  camp: DeskRegisterCampSummary;
};
