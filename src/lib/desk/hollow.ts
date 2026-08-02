import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  campaignRequiresAttention,
  emptyStatusCounts,
  isOnChainRewardType,
  type DeskCampaignDetail,
  type DeskCampaignListItem,
  type DeskCampaignPreview,
  type DeskCampaignStatusCounts,
  type DeskHollowFilter,
  type DeskRecipientView,
} from "@/lib/desk/hollow-types";
import {
  adminCancelCampaign,
  adminCorrectTransaction,
  adminCreateCampaignDraft,
  adminCreateCampaignFromGathering,
  adminGetCampaign,
  adminListCampaigns,
  adminMakeCampaignAvailable,
  adminMarkConfirmed,
  adminPreviewCampaign,
  adminRecordTransaction,
  adminResolveCampaign,
  adminUpdateDraftCampaign,
  type CreateCampaignInput,
} from "@/lib/greenwood/hollow/campaign-ops";
import {
  explorerTxUrl,
  shortenWallet,
} from "@/lib/greenwood/hollow/explorer";
import type {
  AdminCampaignListItem,
  HollowRewardStatus,
} from "@/lib/greenwood/hollow/types";
import { assertProfileId } from "@/lib/leaf/validate";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function bumpCount(
  counts: DeskCampaignStatusCounts,
  status: HollowRewardStatus | null | undefined,
): void {
  if (!status) return;
  switch (status) {
    case "claimed":
      counts.claimed += 1;
      break;
    case "awaiting_send":
      counts.awaitingSend += 1;
      break;
    case "sent":
      counts.sent += 1;
      break;
    case "confirmed":
      counts.confirmed += 1;
      break;
    case "failed":
      counts.failed += 1;
      break;
    case "available":
      counts.available += 1;
      break;
    case "draft":
      counts.draft += 1;
      break;
    default:
      break;
  }
}

type HollowAgg = {
  counts: DeskCampaignStatusCounts;
  availableAt: string | null;
  missingWallet: boolean;
};

async function loadHollowAggByCampaign(
  db: SupabaseClient,
  campaignIds: string[],
): Promise<Map<string, HollowAgg>> {
  const map = new Map<string, HollowAgg>();
  for (const id of campaignIds) {
    map.set(id, {
      counts: emptyStatusCounts(),
      availableAt: null,
      missingWallet: false,
    });
  }
  if (campaignIds.length === 0) return map;

  const { data, error } = await db
    .from("greenwood_hollow_rewards")
    .select("campaign_id, status, available_at, wallet_address_snapshot, reward_type")
    .in("campaign_id", campaignIds);
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const r = row as {
      campaign_id: string | null;
      status: HollowRewardStatus;
      available_at: string | null;
      wallet_address_snapshot: string | null;
      reward_type: string;
    };
    if (!r.campaign_id) continue;
    const agg = map.get(r.campaign_id) ?? {
      counts: emptyStatusCounts(),
      availableAt: null,
      missingWallet: false,
    };
    bumpCount(agg.counts, r.status);
    if (
      r.available_at &&
      (!agg.availableAt || r.available_at < agg.availableAt)
    ) {
      agg.availableAt = r.available_at;
    }
    if (
      (r.reward_type === "eth" || r.reward_type === "erc20") &&
      !r.wallet_address_snapshot
    ) {
      agg.missingWallet = true;
    }
    map.set(r.campaign_id, agg);
  }
  return map;
}

function toDeskListItem(
  item: AdminCampaignListItem,
  agg: HollowAgg,
): DeskCampaignListItem {
  return {
    ...item,
    statusCounts: agg.counts,
    availableAt: agg.availableAt,
    requiresAttention: campaignRequiresAttention(
      item.status,
      agg.counts,
      agg.missingWallet,
    ),
  };
}

function matchesFilter(
  item: DeskCampaignListItem,
  filter: DeskHollowFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "draft":
      return item.status === "draft";
    case "resolved":
      return item.status === "resolved";
    case "available":
      return item.status === "available" || item.status === "executing";
    case "completed":
      return item.status === "completed";
    case "completed_partial":
      return item.status === "completed_partial";
    case "cancelled":
      return item.status === "cancelled";
    case "leaf":
      return item.rewardType === "leaf";
    case "on_chain":
      return isOnChainRewardType(item.rewardType);
    case "requires_attention":
      return item.requiresAttention;
    default:
      return true;
  }
}

function enrichRecipients(
  campaign: Awaited<ReturnType<typeof adminGetCampaign>>,
): DeskRecipientView[] {
  return campaign.recipients.map((r) => ({
    ...r,
    walletShort: shortenWallet(r.walletAddressSnapshot),
    explorerUrl: explorerTxUrl(campaign.assetChainId, r.transactionHash),
  }));
}

export async function listDeskCampaigns(
  filter: DeskHollowFilter = "all",
): Promise<DeskCampaignListItem[]> {
  const db = await defaultAdmin();
  const items = await adminListCampaigns(db);
  const aggs = await loadHollowAggByCampaign(
    db,
    items.map((i) => i.id),
  );
  return items
    .map((item) =>
      toDeskListItem(
        item,
        aggs.get(item.id) ?? {
          counts: emptyStatusCounts(),
          availableAt: null,
          missingWallet: false,
        },
      ),
    )
    .filter((item) => matchesFilter(item, filter));
}

export async function getDeskCampaign(
  campaignId: string,
): Promise<DeskCampaignDetail> {
  const id = assertProfileId(campaignId);
  const db = await defaultAdmin();
  const campaign = await adminGetCampaign(id, db);
  const agg =
    (await loadHollowAggByCampaign(db, [id])).get(id) ?? {
      counts: emptyStatusCounts(),
      availableAt: null,
      missingWallet: false,
    };
  const { createdByActorId, recipients, ...rest } = campaign;
  void createdByActorId;
  void recipients;
  return {
    ...rest,
    recipients: enrichRecipients(campaign),
    statusCounts: agg.counts,
    availableAt: agg.availableAt,
    requiresAttention: campaignRequiresAttention(
      campaign.status,
      agg.counts,
      agg.missingWallet,
    ),
  };
}

export async function previewDeskCampaign(
  campaignId: string,
): Promise<DeskCampaignPreview> {
  const preview = await adminPreviewCampaign(campaignId);
  const validRecipientCount = preview.recipients.filter((r) => r.valid).length;
  const invalidRecipientCount = preview.recipients.length - validRecipientCount;
  return {
    campaignId: preview.campaignId,
    title: preview.title,
    rewardType: preview.rewardType,
    amountPerRecipient: preview.amountPerRecipient,
    recipientCount: preview.recipientCount,
    totalAmount: preview.totalAmount,
    gatheringId: preview.gatheringId,
    gatheringTitle: preview.gatheringTitle,
    walletCoverage: preview.walletCoverage,
    missingWalletCount: preview.missingWalletCount,
    duplicateCount: preview.duplicateCount,
    excludedCount: preview.excludedCount,
    validRecipientCount,
    invalidRecipientCount,
    recipients: preview.recipients.map((r) => ({
      profileId: r.profileId,
      outlawLabel: r.outlawLabel,
      displayName: r.displayName,
      eligibilitySource: r.eligibilitySource,
      eligibilitySourceId: r.eligibilitySourceId,
      valid: r.valid,
      exclusionReason: r.exclusionReason,
      walletShort: shortenWallet(r.walletAddress),
    })),
  };
}

export async function deskCreateCampaignDraft(
  input: CreateCampaignInput,
  actorId: string,
) {
  return adminCreateCampaignDraft(input, actorId);
}

export async function deskCreateCampaignFromGathering(
  gatheringId: string,
  input: Omit<CreateCampaignInput, "recipientRule" | "gatheringId">,
  actorId: string,
) {
  return adminCreateCampaignFromGathering(gatheringId, input, actorId);
}

export async function deskUpdateDraftCampaign(
  campaignId: string,
  input: {
    title?: string;
    reason?: string;
    amountPerRecipient?: number | null;
    profileIds?: string[];
    assetChainId?: number | null;
    assetSymbol?: string | null;
    assetContractAddress?: string | null;
  },
  actorId: string,
) {
  return adminUpdateDraftCampaign(campaignId, input, actorId);
}

export async function deskResolveCampaign(campaignId: string, actorId: string) {
  return adminResolveCampaign(campaignId, actorId);
}

export async function deskMakeCampaignAvailable(
  campaignId: string,
  actorId: string,
) {
  return adminMakeCampaignAvailable(campaignId, actorId);
}

export async function deskCancelCampaign(
  campaignId: string,
  actorId: string,
  reason: string | null,
) {
  return adminCancelCampaign(campaignId, actorId, reason);
}

export async function deskRecordTransaction(
  rewardId: string,
  input: { transactionHash: string; chainId?: number | null },
  actorId: string,
) {
  return adminRecordTransaction(rewardId, input, actorId);
}

export async function deskCorrectTransaction(
  rewardId: string,
  input: { transactionHash: string; reason: string },
  actorId: string,
) {
  return adminCorrectTransaction(rewardId, input, actorId);
}

export async function deskMarkConfirmed(rewardId: string, actorId: string) {
  return adminMarkConfirmed(rewardId, actorId);
}
