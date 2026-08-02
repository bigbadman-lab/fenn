import type {
  AdminCampaignDetail,
  AdminCampaignListItem,
  AdminCampaignPreview,
  CampaignStatus,
  HollowRewardType,
} from "@/lib/greenwood/hollow/types";

export type DeskHollowFilter =
  | "all"
  | "draft"
  | "resolved"
  | "available"
  | "completed"
  | "completed_partial"
  | "cancelled"
  | "leaf"
  | "on_chain"
  | "requires_attention";

export type DeskCampaignStatusCounts = {
  claimed: number;
  awaitingSend: number;
  sent: number;
  confirmed: number;
  failed: number;
  available: number;
  draft: number;
};

export type DeskCampaignListItem = AdminCampaignListItem & {
  statusCounts: DeskCampaignStatusCounts;
  requiresAttention: boolean;
  /** Earliest Hollow available_at for this campaign, if any. */
  availableAt: string | null;
};

export type DeskRecipientView = AdminCampaignDetail["recipients"][number] & {
  walletShort: string | null;
  explorerUrl: string | null;
};

export type DeskCampaignDetail = Omit<
  AdminCampaignDetail,
  "createdByActorId" | "recipients"
> & {
  statusCounts: DeskCampaignStatusCounts;
  requiresAttention: boolean;
  availableAt: string | null;
  recipients: DeskRecipientView[];
};

export type DeskRecipientPreview = Omit<
  AdminCampaignPreview["recipients"][number],
  "walletAddress"
> & {
  walletShort: string | null;
};

export type DeskCampaignPreview = Omit<AdminCampaignPreview, "recipients"> & {
  recipients: DeskRecipientPreview[];
  validRecipientCount: number;
  invalidRecipientCount: number;
};

export function isOnChainRewardType(type: HollowRewardType): boolean {
  return type === "eth" || type === "erc20";
}

export function campaignRequiresAttention(
  status: CampaignStatus,
  counts: DeskCampaignStatusCounts,
  missingWalletHint = false,
): boolean {
  if (status === "draft" || status === "resolved") return true;
  if (status === "completed_partial") return true;
  if (counts.awaitingSend > 0) return true;
  if (counts.failed > 0) return true;
  if (missingWalletHint) return true;
  return false;
}

export function emptyStatusCounts(): DeskCampaignStatusCounts {
  return {
    claimed: 0,
    awaitingSend: 0,
    sent: 0,
    confirmed: 0,
    failed: 0,
    available: 0,
    draft: 0,
  };
}
