export type HollowRewardType = "leaf" | "eth" | "erc20" | "informational";

export type CampaignRecipientRule =
  | "manual_profiles"
  | "gathering_open_hands";

export type CampaignStatus =
  | "draft"
  | "resolved"
  | "available"
  | "executing"
  | "completed"
  | "completed_partial"
  | "cancelled";

export type CampaignRecipientStatus =
  | "pending"
  | "ready"
  | "fulfilled"
  | "failed"
  | "cancelled";

export type HollowRewardStatus =
  | "draft"
  | "available"
  | "claimed"
  | "expired"
  | "cancelled"
  | "failed"
  | "awaiting_send"
  | "sent"
  | "confirmed"
  | "acknowledged";

export type RewardCampaignRow = {
  id: string;
  title: string;
  reason: string;
  reward_type: HollowRewardType;
  amount_per_recipient: number | string | null;
  asset_chain_id: number | null;
  asset_contract_address: string | null;
  asset_symbol: string | null;
  recipient_rule: CampaignRecipientRule;
  gathering_id: string | null;
  status: CampaignStatus;
  recipient_count: number;
  total_amount: number | string | null;
  resolved_at: string | null;
  executed_at: string | null;
  cancelled_at: string | null;
  created_by_actor_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CampaignRecipientRow = {
  id: string;
  campaign_id: string;
  profile_id: string;
  wallet_address_snapshot: string | null;
  eligibility_source: "manual_profile" | "gathering_open_hand";
  eligibility_source_id: string | null;
  resolved_at: string;
  status: CampaignRecipientStatus;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type HollowRewardRow = {
  id: string;
  campaign_id: string | null;
  campaign_recipient_id: string | null;
  profile_id: string;
  reward_type: HollowRewardType;
  title: string;
  reason: string;
  amount: number | string | null;
  asset_chain_id: number | null;
  asset_contract_address: string | null;
  asset_symbol: string | null;
  wallet_address_snapshot: string | null;
  status: HollowRewardStatus;
  available_at: string | null;
  expires_at: string | null;
  claimed_at: string | null;
  sent_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  transaction_hash: string | null;
  leaf_ledger_entry_id: string | null;
  idempotency_key: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

/** Member-safe Hollow projection. */
export type SafeHollowReward = {
  id: string;
  title: string;
  reason: string;
  rewardType: HollowRewardType;
  amount: number | null;
  assetSymbol: string | null;
  assetChainId: number | null;
  status: HollowRewardStatus;
  availableAt: string | null;
  expiresAt: string | null;
  claimedAt: string | null;
  sentAt: string | null;
  confirmedAt: string | null;
  canClaim: boolean;
  canAcknowledge: boolean;
  walletShort: string | null;
  transactionHash: string | null;
  explorerUrl: string | null;
  campaignTitle: string | null;
  gatheringTitle: string | null;
  serverNow: string;
};

export type HollowInboxSnapshot = {
  rewards: SafeHollowReward[];
  availableCount: number;
  serverNow: string;
};

export type HollowFireStatus = {
  hasAvailable: boolean;
  hasAny: boolean;
  availableCount: number;
  serverNow: string;
};

export type AdminCampaignListItem = {
  id: string;
  title: string;
  reason: string;
  rewardType: HollowRewardType;
  amountPerRecipient: number | null;
  assetSymbol: string | null;
  assetChainId: number | null;
  recipientRule: CampaignRecipientRule;
  gatheringId: string | null;
  gatheringTitle: string | null;
  status: CampaignStatus;
  recipientCount: number;
  totalAmount: number | null;
  resolvedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminRecipientPreview = {
  profileId: string;
  outlawLabel: string;
  displayName: string;
  walletAddress: string | null;
  eligibilitySource: "manual_profile" | "gathering_open_hand";
  eligibilitySourceId: string | null;
  valid: boolean;
  exclusionReason: string | null;
};

export type AdminCampaignPreview = {
  campaignId: string;
  title: string;
  rewardType: HollowRewardType;
  amountPerRecipient: number | null;
  recipientCount: number;
  totalAmount: number | null;
  gatheringId: string | null;
  gatheringTitle: string | null;
  walletCoverage: number;
  missingWalletCount: number;
  duplicateCount: number;
  excludedCount: number;
  recipients: AdminRecipientPreview[];
};

export type AdminCampaignRecipientView = {
  id: string;
  profileId: string;
  outlawLabel: string;
  displayName: string;
  walletAddressSnapshot: string | null;
  eligibilitySource: string;
  status: CampaignRecipientStatus;
  failureReason: string | null;
  hollowRewardId: string | null;
  hollowStatus: HollowRewardStatus | null;
  transactionHash: string | null;
  claimedAt: string | null;
  sentAt: string | null;
};

export type AdminCampaignDetail = AdminCampaignListItem & {
  assetContractAddress: string | null;
  createdByActorId: string;
  recipients: AdminCampaignRecipientView[];
  serverNow: string;
};
