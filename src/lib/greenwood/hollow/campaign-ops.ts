import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { resolveGatheringStateFromRow } from "@/lib/greenwood/gatherings/state";
import type { GatheringRow } from "@/lib/greenwood/gatherings/types";
import { isValidTxHash } from "@/lib/greenwood/hollow/explorer";
import {
  assertCampaignTransition,
  availableStatusForType,
  canTransitionHollow,
} from "@/lib/greenwood/hollow/state";
import type {
  AdminCampaignDetail,
  AdminCampaignListItem,
  AdminCampaignPreview,
  AdminCampaignRecipientView,
  AdminRecipientPreview,
  CampaignRecipientRule,
  HollowRewardType,
  RewardCampaignRow,
} from "@/lib/greenwood/hollow/types";
import { formatOutlawNumber } from "@/lib/profiles/types";
import {
  assertProfileId,
  assertSafeIntegerAmount,
} from "@/lib/leaf/validate";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function numOrNull(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  return assertSafeIntegerAmount(value, "amount", "UNSAFE_BIGINT");
}

async function loadGatheringTitle(
  db: SupabaseClient,
  gatheringId: string | null,
): Promise<string | null> {
  if (!gatheringId) return null;
  const { data } = await db
    .from("greenwood_gatherings")
    .select("title")
    .eq("id", gatheringId)
    .maybeSingle();
  return (data as { title: string } | null)?.title ?? null;
}

function toListItem(
  row: RewardCampaignRow,
  gatheringTitle: string | null,
): AdminCampaignListItem {
  return {
    id: row.id,
    title: row.title,
    reason: row.reason,
    rewardType: row.reward_type,
    amountPerRecipient: numOrNull(row.amount_per_recipient),
    assetSymbol: row.asset_symbol,
    assetChainId: row.asset_chain_id,
    recipientRule: row.recipient_rule,
    gatheringId: row.gathering_id,
    gatheringTitle,
    status: row.status,
    recipientCount: row.recipient_count,
    totalAmount: numOrNull(row.total_amount),
    resolvedAt: row.resolved_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadProfileLabels(
  db: SupabaseClient,
  profileIds: string[],
): Promise<
  Map<
    string,
    {
      outlawLabel: string;
      displayName: string;
      wallet: string;
      greenwoodEnteredAt: string | null;
    }
  >
> {
  const map = new Map<
    string,
    {
      outlawLabel: string;
      displayName: string;
      wallet: string;
      greenwoodEnteredAt: string | null;
    }
  >();
  if (profileIds.length === 0) return map;
  const { data, error } = await db
    .from("profiles")
    .select("id, outlaw_number, alias, wallet_address, greenwood_entered_at")
    .in("id", profileIds);
  if (error) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Failed to load profiles",
      500,
    );
  }
  for (const p of (data ?? []) as Array<{
    id: string;
    outlaw_number: number | string;
    alias: string | null;
    wallet_address: string;
    greenwood_entered_at: string | null;
  }>) {
    const n = assertSafeIntegerAmount(
      p.outlaw_number,
      "outlaw_number",
      "UNSAFE_BIGINT",
    );
    const outlawLabel = `OUTLAW ${formatOutlawNumber(n)}`;
    map.set(p.id, {
      outlawLabel,
      displayName: p.alias?.trim() || outlawLabel,
      wallet: p.wallet_address,
      greenwoodEnteredAt: p.greenwood_entered_at,
    });
  }
  return map;
}

export type CreateCampaignInput = {
  title: string;
  reason?: string;
  rewardType: HollowRewardType;
  amountPerRecipient?: number | null;
  assetChainId?: number | null;
  assetContractAddress?: string | null;
  assetSymbol?: string | null;
  recipientRule: CampaignRecipientRule;
  gatheringId?: string | null;
  profileIds?: string[];
};

export async function adminListCampaigns(
  admin?: SupabaseClient,
): Promise<AdminCampaignListItem[]> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("greenwood_reward_campaigns")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Failed to list campaigns",
      500,
    );
  }
  const rows = (data ?? []) as RewardCampaignRow[];
  const items: AdminCampaignListItem[] = [];
  for (const row of rows) {
    items.push(
      toListItem(row, await loadGatheringTitle(db, row.gathering_id)),
    );
  }
  return items;
}

export async function adminCreateCampaignDraft(
  input: CreateCampaignInput,
  actorId: string,
  admin?: SupabaseClient,
): Promise<AdminCampaignListItem> {
  const db = admin ?? (await defaultAdmin());
  const title = input.title.trim();
  if (!title) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Title is required",
      400,
    );
  }
  if (
    input.recipientRule === "gathering_open_hands" &&
    !input.gatheringId
  ) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Gathering is required for open-hand campaigns",
      400,
    );
  }
  if (input.gatheringId) {
    assertProfileId(input.gatheringId);
  }

  const amount =
    input.rewardType === "informational"
      ? null
      : input.amountPerRecipient ?? null;
  if (
    input.rewardType !== "informational" &&
    (amount == null || amount <= 0 || !Number.isInteger(amount))
  ) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Positive integer amount is required",
      400,
    );
  }

  const { data, error } = await db
    .from("greenwood_reward_campaigns")
    .insert({
      title,
      reason: (input.reason ?? "").trim(),
      reward_type: input.rewardType,
      amount_per_recipient: amount,
      asset_chain_id: input.assetChainId ?? null,
      asset_contract_address: input.assetContractAddress?.trim() || null,
      asset_symbol: input.assetSymbol?.trim() || null,
      recipient_rule: input.recipientRule,
      gathering_id: input.gatheringId ?? null,
      status: "draft",
      created_by_actor_id: actorId,
      metadata:
        input.recipientRule === "manual_profiles"
          ? { pending_profile_ids: input.profileIds ?? [] }
          : {},
    })
    .select("*")
    .maybeSingle();

  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      error?.message ?? "Failed to create campaign",
      500,
    );
  }
  const row = data as RewardCampaignRow;
  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.campaign.create",
    entityType: "greenwood_reward_campaign",
    entityId: row.id,
    afterState: { status: row.status, reward_type: row.reward_type },
  });
  return toListItem(row, await loadGatheringTitle(db, row.gathering_id));
}

export async function adminCreateCampaignFromGathering(
  gatheringId: string,
  input: Omit<CreateCampaignInput, "recipientRule" | "gatheringId">,
  actorId: string,
  admin?: SupabaseClient,
): Promise<AdminCampaignListItem> {
  const db = admin ?? (await defaultAdmin());
  const gId = assertProfileId(gatheringId);
  const { data: gathering, error } = await db
    .from("greenwood_gatherings")
    .select("*")
    .eq("id", gId)
    .maybeSingle();
  if (error || !gathering) {
    throw new GreenwoodError(
      "greenwood_gathering_not_found",
      "Gathering not found",
      404,
    );
  }
  const g = gathering as GatheringRow;
  const resolved = resolveGatheringStateFromRow(g);
  if (resolved === "cancelled" || g.status === "cancelled") {
    throw new GreenwoodError(
      "greenwood_gathering_cancelled",
      "Cancelled Gatherings cannot seed campaigns",
      409,
    );
  }
  if (resolved !== "closed" && g.status !== "closed") {
    throw new GreenwoodError(
      "greenwood_hollow_snapshot_invalid",
      "Only closed Gatherings can seed open-hand campaigns",
      409,
    );
  }

  return adminCreateCampaignDraft(
    {
      ...input,
      title: input.title || `Hollow · ${g.title}`,
      reason: input.reason || `Final raised hands · ${g.title}`,
      recipientRule: "gathering_open_hands",
      gatheringId: gId,
    },
    actorId,
    db,
  );
}

type Candidate = {
  profileId: string;
  wallet: string | null;
  eligibilitySource: "manual_profile" | "gathering_open_hand";
  eligibilitySourceId: string | null;
  valid: boolean;
  exclusionReason: string | null;
};

async function collectCandidates(
  db: SupabaseClient,
  campaign: RewardCampaignRow,
): Promise<{ candidates: Candidate[]; excluded: Candidate[] }> {
  const excluded: Candidate[] = [];
  const byProfile = new Map<string, Candidate>();

  if (campaign.recipient_rule === "gathering_open_hands") {
    if (!campaign.gathering_id) {
      throw new GreenwoodError(
        "greenwood_hollow_failed",
        "Campaign missing gathering",
        400,
      );
    }
    const { data: gathering } = await db
      .from("greenwood_gatherings")
      .select("*")
      .eq("id", campaign.gathering_id)
      .maybeSingle();
    if (!gathering) {
      throw new GreenwoodError(
        "greenwood_gathering_not_found",
        "Gathering not found",
        404,
      );
    }
    const g = gathering as GatheringRow;
    const resolved = resolveGatheringStateFromRow(g);
    if (resolved === "cancelled" || g.status === "cancelled") {
      throw new GreenwoodError(
        "greenwood_gathering_cancelled",
        "Cancelled Gatherings cannot be snapshotted",
        409,
      );
    }
    if (resolved !== "closed" && g.status !== "closed") {
      throw new GreenwoodError(
        "greenwood_hollow_snapshot_invalid",
        "Gathering must be closed before open-hand snapshot",
        409,
      );
    }

    const { data: hands, error } = await db
      .from("greenwood_gathering_hands")
      .select("id, profile_id")
      .eq("gathering_id", campaign.gathering_id)
      .is("lowered_at", null);
    if (error) {
      throw new GreenwoodError(
        "greenwood_hollow_failed",
        "Failed to load open hands",
        500,
      );
    }

    const profileIds = [
      ...new Set(
        ((hands ?? []) as Array<{ id: string; profile_id: string }>).map(
          (h) => h.profile_id,
        ),
      ),
    ];
    const labels = await loadProfileLabels(db, profileIds);
    for (const hand of (hands ?? []) as Array<{
      id: string;
      profile_id: string;
    }>) {
      if (byProfile.has(hand.profile_id)) continue;
      const label = labels.get(hand.profile_id);
      if (!label || label.greenwoodEnteredAt == null) {
        excluded.push({
          profileId: hand.profile_id,
          wallet: label?.wallet ?? null,
          eligibilitySource: "gathering_open_hand",
          eligibilitySourceId: hand.id,
          valid: false,
          exclusionReason: "not a Greenwood member",
        });
        continue;
      }
      byProfile.set(hand.profile_id, {
        profileId: hand.profile_id,
        wallet: label.wallet,
        eligibilitySource: "gathering_open_hand",
        eligibilitySourceId: hand.id,
        valid: true,
        exclusionReason: null,
      });
    }
  } else {
    const pending =
      (campaign.metadata?.pending_profile_ids as string[] | undefined) ?? [];
    const unique = [...new Set(pending.map((id) => assertProfileId(id)))];
    const labels = await loadProfileLabels(db, unique);
    for (const profileId of unique) {
      const label = labels.get(profileId);
      if (!label) {
        excluded.push({
          profileId,
          wallet: null,
          eligibilitySource: "manual_profile",
          eligibilitySourceId: profileId,
          valid: false,
          exclusionReason: "profile not found",
        });
        continue;
      }
      if (label.greenwoodEnteredAt == null) {
        excluded.push({
          profileId,
          wallet: label.wallet,
          eligibilitySource: "manual_profile",
          eligibilitySourceId: profileId,
          valid: false,
          exclusionReason: "not a Greenwood member",
        });
        continue;
      }
      byProfile.set(profileId, {
        profileId,
        wallet: label.wallet,
        eligibilitySource: "manual_profile",
        eligibilitySourceId: profileId,
        valid: true,
        exclusionReason: null,
      });
    }
  }

  return { candidates: [...byProfile.values()], excluded };
}

export async function adminPreviewCampaign(
  campaignId: string,
  admin?: SupabaseClient,
): Promise<AdminCampaignPreview> {
  const db = admin ?? (await defaultAdmin());
  const id = assertProfileId(campaignId);
  const { data, error } = await db
    .from("greenwood_reward_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_hollow_not_found",
      "Campaign not found",
      404,
    );
  }
  const campaign = data as RewardCampaignRow;
  const { candidates, excluded } = await collectCandidates(db, campaign);
  const labels = await loadProfileLabels(
    db,
    [...candidates, ...excluded].map((c) => c.profileId),
  );

  const needsWallet =
    campaign.reward_type === "eth" || campaign.reward_type === "erc20";
  const recipients: AdminRecipientPreview[] = [
    ...candidates.map((c) => {
      const label = labels.get(c.profileId);
      const missingWallet = needsWallet && !c.wallet;
      return {
        profileId: c.profileId,
        outlawLabel: label?.outlawLabel ?? "OUTLAW ——",
        displayName: label?.displayName ?? "unknown",
        walletAddress: c.wallet,
        eligibilitySource: c.eligibilitySource,
        eligibilitySourceId: c.eligibilitySourceId,
        valid: c.valid && !missingWallet,
        exclusionReason: missingWallet
          ? "missing wallet"
          : c.exclusionReason,
      };
    }),
    ...excluded.map((c) => {
      const label = labels.get(c.profileId);
      return {
        profileId: c.profileId,
        outlawLabel: label?.outlawLabel ?? "OUTLAW ——",
        displayName: label?.displayName ?? "unknown",
        walletAddress: c.wallet,
        eligibilitySource: c.eligibilitySource,
        eligibilitySourceId: c.eligibilitySourceId,
        valid: false,
        exclusionReason: c.exclusionReason,
      };
    }),
  ];

  const validRecipients = recipients.filter((r) => r.valid);
  const amount = numOrNull(campaign.amount_per_recipient);
  const missingWalletCount = needsWallet
    ? candidates.filter((c) => !c.wallet).length
    : 0;

  return {
    campaignId: campaign.id,
    title: campaign.title,
    rewardType: campaign.reward_type,
    amountPerRecipient: amount,
    recipientCount: validRecipients.length,
    totalAmount:
      amount != null ? amount * validRecipients.length : null,
    gatheringId: campaign.gathering_id,
    gatheringTitle: await loadGatheringTitle(db, campaign.gathering_id),
    walletCoverage: validRecipients.filter((r) => r.walletAddress).length,
    missingWalletCount,
    duplicateCount: 0,
    excludedCount: recipients.length - validRecipients.length,
    recipients,
  };
}

export async function adminResolveCampaign(
  campaignId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<AdminCampaignDetail> {
  const db = admin ?? (await defaultAdmin());
  const id = assertProfileId(campaignId);
  const { data, error } = await db
    .from("greenwood_reward_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_hollow_not_found",
      "Campaign not found",
      404,
    );
  }
  const campaign = data as RewardCampaignRow;

  if (campaign.status === "resolved" || campaign.status === "available") {
    return adminGetCampaign(id, db);
  }
  if (campaign.status !== "draft") {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Only draft campaigns can be resolved",
      409,
    );
  }

  const preview = await adminPreviewCampaign(id, db);
  const valid = preview.recipients.filter((r) => r.valid);
  if (valid.length === 0) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "No valid recipients to resolve",
      400,
    );
  }

  const needsWallet =
    campaign.reward_type === "eth" || campaign.reward_type === "erc20";
  if (needsWallet && preview.missingWalletCount > 0) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "On-chain campaigns require wallet snapshots for every recipient",
      409,
    );
  }

  const now = new Date().toISOString();
  const amount = numOrNull(campaign.amount_per_recipient);

  for (const recipient of valid) {
    const { data: recipientRow, error: recipientError } = await db
      .from("greenwood_reward_campaign_recipients")
      .upsert(
        {
          campaign_id: id,
          profile_id: recipient.profileId,
          wallet_address_snapshot: needsWallet
            ? recipient.walletAddress
            : campaign.reward_type === "leaf"
              ? null
              : recipient.walletAddress,
          eligibility_source: recipient.eligibilitySource,
          eligibility_source_id: recipient.eligibilitySourceId,
          resolved_at: now,
          status: "ready",
        },
        { onConflict: "campaign_id,profile_id" },
      )
      .select("*")
      .maybeSingle();

    if (recipientError || !recipientRow) {
      throw new GreenwoodError(
        "greenwood_hollow_failed",
        recipientError?.message ?? "Failed to freeze recipient",
        500,
      );
    }

    const recipientId = (recipientRow as { id: string }).id;
    const hollowKey = `hollow_campaign:${id}:recipient:${recipient.profileId}`;
    const { error: hollowError } = await db
      .from("greenwood_hollow_rewards")
      .upsert(
        {
          campaign_id: id,
          campaign_recipient_id: recipientId,
          profile_id: recipient.profileId,
          reward_type: campaign.reward_type,
          title: campaign.title,
          reason: campaign.reason,
          amount,
          asset_chain_id: campaign.asset_chain_id,
          asset_contract_address: campaign.asset_contract_address,
          asset_symbol: campaign.asset_symbol,
          wallet_address_snapshot: (recipientRow as {
            wallet_address_snapshot: string | null;
          }).wallet_address_snapshot,
          status: "draft",
          idempotency_key: hollowKey,
        },
        { onConflict: "idempotency_key" },
      );
    if (hollowError) {
      throw new GreenwoodError(
        "greenwood_hollow_failed",
        hollowError.message,
        500,
      );
    }
  }

  assertCampaignTransition(campaign.status, "resolved");
  const total =
    amount != null ? amount * valid.length : null;
  const { error: updateError } = await db
    .from("greenwood_reward_campaigns")
    .update({
      status: "resolved",
      resolved_at: now,
      recipient_count: valid.length,
      total_amount: total,
    })
    .eq("id", id)
    .eq("status", "draft");
  if (updateError) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      updateError.message,
      500,
    );
  }

  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.campaign.resolve",
    entityType: "greenwood_reward_campaign",
    entityId: id,
    beforeState: { status: "draft" },
    afterState: {
      status: "resolved",
      recipient_count: valid.length,
      total_amount: total,
    },
  });

  return adminGetCampaign(id, db);
}

export async function adminMakeCampaignAvailable(
  campaignId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<AdminCampaignDetail> {
  const db = admin ?? (await defaultAdmin());
  const id = assertProfileId(campaignId);
  const { data, error } = await db
    .from("greenwood_reward_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_hollow_not_found",
      "Campaign not found",
      404,
    );
  }
  const campaign = data as RewardCampaignRow;
  if (campaign.status === "available") {
    return adminGetCampaign(id, db);
  }
  if (campaign.status !== "resolved") {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Campaign must be resolved before making available",
      409,
    );
  }

  const nextStatus = availableStatusForType(campaign.reward_type);
  const now = new Date().toISOString();
  const { error: hollowError } = await db
    .from("greenwood_hollow_rewards")
    .update({
      status: nextStatus,
      available_at: now,
    })
    .eq("campaign_id", id)
    .eq("status", "draft");
  if (hollowError) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      hollowError.message,
      500,
    );
  }

  assertCampaignTransition("resolved", "available");
  const { error: updateError } = await db
    .from("greenwood_reward_campaigns")
    .update({ status: "available", executed_at: now })
    .eq("id", id)
    .eq("status", "resolved");
  if (updateError) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      updateError.message,
      500,
    );
  }

  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.campaign.make_available",
    entityType: "greenwood_reward_campaign",
    entityId: id,
    beforeState: { status: "resolved" },
    afterState: { status: "available", hollow_status: nextStatus },
  });

  return adminGetCampaign(id, db);
}

export async function adminCancelCampaign(
  campaignId: string,
  actorId: string,
  reason: string | null,
  admin?: SupabaseClient,
): Promise<AdminCampaignDetail> {
  const db = admin ?? (await defaultAdmin());
  const id = assertProfileId(campaignId);
  const { data, error } = await db
    .from("greenwood_reward_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_hollow_not_found",
      "Campaign not found",
      404,
    );
  }
  const campaign = data as RewardCampaignRow;
  if (campaign.status === "cancelled") {
    return adminGetCampaign(id, db);
  }
  if (
    campaign.status === "completed" ||
    campaign.status === "completed_partial"
  ) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Completed campaigns cannot be cancelled",
      409,
    );
  }

  const { count: claimedCount } = await db
    .from("greenwood_hollow_rewards")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id)
    .in("status", ["claimed", "sent", "confirmed"]);
  if ((claimedCount ?? 0) > 0) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Cannot cancel after claims or sends have begun",
      409,
    );
  }

  assertCampaignTransition(campaign.status, "cancelled");
  const now = new Date().toISOString();
  await db
    .from("greenwood_hollow_rewards")
    .update({ status: "cancelled", cancelled_at: now })
    .eq("campaign_id", id)
    .in("status", ["draft", "available", "awaiting_send"]);

  await db
    .from("greenwood_reward_campaign_recipients")
    .update({ status: "cancelled" })
    .eq("campaign_id", id)
    .in("status", ["pending", "ready"]);

  const { error: updateError } = await db
    .from("greenwood_reward_campaigns")
    .update({
      status: "cancelled",
      cancelled_at: now,
      metadata: {
        ...campaign.metadata,
        cancellation_reason: reason?.trim() || null,
      },
    })
    .eq("id", id);
  if (updateError) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      updateError.message,
      500,
    );
  }

  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.campaign.cancel",
    entityType: "greenwood_reward_campaign",
    entityId: id,
    beforeState: { status: campaign.status },
    afterState: { status: "cancelled" },
    reason,
  });

  return adminGetCampaign(id, db);
}

export async function adminRecordTransaction(
  rewardId: string,
  input: { transactionHash: string; chainId?: number | null },
  actorId: string,
  admin?: SupabaseClient,
): Promise<AdminCampaignDetail> {
  const db = admin ?? (await defaultAdmin());
  const id = assertProfileId(rewardId);
  const hash = input.transactionHash.trim();
  if (!isValidTxHash(hash)) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "A valid transaction hash is required to mark sent",
      400,
    );
  }

  const { data, error } = await db
    .from("greenwood_hollow_rewards")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_hollow_not_found",
      "Reward not found",
      404,
    );
  }
  const reward = data as {
    id: string;
    campaign_id: string | null;
    reward_type: HollowRewardType;
    status: string;
    transaction_hash: string | null;
    campaign_recipient_id: string | null;
    asset_chain_id: number | null;
  };

  if (reward.reward_type !== "eth" && reward.reward_type !== "erc20") {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Only ETH/ERC-20 rewards record transactions",
      409,
    );
  }
  if (reward.transaction_hash && reward.transaction_hash !== hash) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Transaction already recorded; use correction path",
      409,
    );
  }
  if (!canTransitionHollow(reward.reward_type, reward.status as never, "sent")) {
    if (reward.status !== "sent" && reward.status !== "confirmed") {
      throw new GreenwoodError(
        "greenwood_hollow_failed",
        "Reward cannot be marked sent from current status",
        409,
      );
    }
  }

  const now = new Date().toISOString();
  const { error: updateError } = await db
    .from("greenwood_hollow_rewards")
    .update({
      status: "sent",
      transaction_hash: hash,
      sent_at: now,
      asset_chain_id: input.chainId ?? reward.asset_chain_id,
    })
    .eq("id", id);
  if (updateError) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      updateError.message,
      500,
    );
  }

  if (reward.campaign_recipient_id) {
    await db
      .from("greenwood_reward_campaign_recipients")
      .update({ status: "fulfilled" })
      .eq("id", reward.campaign_recipient_id);
  }

  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.reward.record_transaction",
    entityType: "greenwood_hollow_reward",
    entityId: id,
    beforeState: {
      status: reward.status,
      transaction_hash: reward.transaction_hash,
    },
    afterState: { status: "sent", transaction_hash: hash },
  });

  if (!reward.campaign_id) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Reward missing campaign",
      500,
    );
  }
  return adminGetCampaign(reward.campaign_id, db);
}

export async function adminMarkConfirmed(
  rewardId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<AdminCampaignDetail> {
  const db = admin ?? (await defaultAdmin());
  const id = assertProfileId(rewardId);
  const { data, error } = await db
    .from("greenwood_hollow_rewards")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_hollow_not_found",
      "Reward not found",
      404,
    );
  }
  const reward = data as {
    campaign_id: string | null;
    status: string;
    transaction_hash: string | null;
    reward_type: HollowRewardType;
  };
  if (!reward.transaction_hash) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Cannot confirm without a transaction hash",
      409,
    );
  }
  if (reward.status !== "sent" && reward.status !== "confirmed") {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Only sent rewards can be manually confirmed",
      409,
    );
  }

  const now = new Date().toISOString();
  await db
    .from("greenwood_hollow_rewards")
    .update({ status: "confirmed", confirmed_at: now })
    .eq("id", id);

  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.reward.mark_confirmed",
    entityType: "greenwood_hollow_reward",
    entityId: id,
    beforeState: { status: reward.status },
    afterState: { status: "confirmed", note: "manual confirmation" },
  });

  if (!reward.campaign_id) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Reward missing campaign",
      500,
    );
  }
  return adminGetCampaign(reward.campaign_id, db);
}

export async function adminCorrectTransaction(
  rewardId: string,
  input: { transactionHash: string; reason: string },
  actorId: string,
  admin?: SupabaseClient,
): Promise<AdminCampaignDetail> {
  const db = admin ?? (await defaultAdmin());
  const id = assertProfileId(rewardId);
  const hash = input.transactionHash.trim();
  if (!isValidTxHash(hash)) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "A valid transaction hash is required",
      400,
    );
  }
  const reason = input.reason.trim();
  if (!reason) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Correction reason is required",
      400,
    );
  }

  const { data, error } = await db
    .from("greenwood_hollow_rewards")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_hollow_not_found",
      "Reward not found",
      404,
    );
  }
  const reward = data as {
    campaign_id: string | null;
    status: string;
    transaction_hash: string | null;
    metadata: Record<string, unknown>;
  };
  if (reward.status !== "sent" && reward.status !== "confirmed") {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Only recorded transactions can be corrected",
      409,
    );
  }

  const prior = reward.transaction_hash;
  await db
    .from("greenwood_hollow_rewards")
    .update({
      transaction_hash: hash,
      status: "sent",
      confirmed_at: null,
      metadata: {
        ...reward.metadata,
        prior_transaction_hash: prior,
        correction_reason: reason,
      },
    })
    .eq("id", id);

  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.reward.correct_transaction",
    entityType: "greenwood_hollow_reward",
    entityId: id,
    beforeState: { transaction_hash: prior, status: reward.status },
    afterState: { transaction_hash: hash, status: "sent" },
    reason,
  });

  if (!reward.campaign_id) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Reward missing campaign",
      500,
    );
  }
  return adminGetCampaign(reward.campaign_id, db);
}

export async function adminUpdateDraftCampaign(
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
  admin?: SupabaseClient,
): Promise<AdminCampaignListItem> {
  const db = admin ?? (await defaultAdmin());
  const id = assertProfileId(campaignId);
  const { data, error } = await db
    .from("greenwood_reward_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_hollow_not_found",
      "Campaign not found",
      404,
    );
  }
  const before = data as RewardCampaignRow;
  if (before.status !== "draft") {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Only draft campaigns can be edited",
      409,
    );
  }

  const patch: Record<string, unknown> = {};
  if (input.title != null) patch.title = input.title.trim();
  if (input.reason != null) patch.reason = input.reason.trim();
  if (input.amountPerRecipient !== undefined) {
    patch.amount_per_recipient = input.amountPerRecipient;
  }
  if (input.assetChainId !== undefined) {
    patch.asset_chain_id = input.assetChainId;
  }
  if (input.assetSymbol !== undefined) {
    patch.asset_symbol = input.assetSymbol?.trim() || null;
  }
  if (input.assetContractAddress !== undefined) {
    patch.asset_contract_address =
      input.assetContractAddress?.trim() || null;
  }
  if (
    input.profileIds != null &&
    before.recipient_rule === "manual_profiles"
  ) {
    patch.metadata = {
      ...before.metadata,
      pending_profile_ids: input.profileIds.map((p) => assertProfileId(p)),
    };
  }

  const { data: updated, error: updateError } = await db
    .from("greenwood_reward_campaigns")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (updateError || !updated) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      updateError?.message ?? "Update failed",
      500,
    );
  }

  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.campaign.update",
    entityType: "greenwood_reward_campaign",
    entityId: id,
    beforeState: { title: before.title },
    afterState: { title: (updated as RewardCampaignRow).title },
  });

  const row = updated as RewardCampaignRow;
  return toListItem(row, await loadGatheringTitle(db, row.gathering_id));
}

export async function adminGetCampaign(
  campaignId: string,
  admin?: SupabaseClient,
): Promise<AdminCampaignDetail> {
  const db = admin ?? (await defaultAdmin());
  const id = assertProfileId(campaignId);
  const { data, error } = await db
    .from("greenwood_reward_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_hollow_not_found",
      "Campaign not found",
      404,
    );
  }
  const campaign = data as RewardCampaignRow;
  const gatheringTitle = await loadGatheringTitle(db, campaign.gathering_id);

  const { data: recipients, error: recipientError } = await db
    .from("greenwood_reward_campaign_recipients")
    .select("*")
    .eq("campaign_id", id)
    .order("resolved_at", { ascending: true });
  if (recipientError) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Failed to load recipients",
      500,
    );
  }

  const recipientRows = (recipients ?? []) as Array<{
    id: string;
    profile_id: string;
    wallet_address_snapshot: string | null;
    eligibility_source: string;
    status: AdminCampaignRecipientView["status"];
    failure_reason: string | null;
  }>;
  const labels = await loadProfileLabels(
    db,
    recipientRows.map((r) => r.profile_id),
  );

  const { data: hollows } = await db
    .from("greenwood_hollow_rewards")
    .select(
      "id, campaign_recipient_id, status, transaction_hash, claimed_at, sent_at",
    )
    .eq("campaign_id", id);
  const hollowByRecipient = new Map<
    string,
    {
      id: string;
      status: AdminCampaignRecipientView["hollowStatus"];
      transaction_hash: string | null;
      claimed_at: string | null;
      sent_at: string | null;
    }
  >();
  for (const h of (hollows ?? []) as Array<{
    id: string;
    campaign_recipient_id: string | null;
    status: NonNullable<AdminCampaignRecipientView["hollowStatus"]>;
    transaction_hash: string | null;
    claimed_at: string | null;
    sent_at: string | null;
  }>) {
    if (h.campaign_recipient_id) {
      hollowByRecipient.set(h.campaign_recipient_id, h);
    }
  }

  const views: AdminCampaignRecipientView[] = recipientRows.map((r) => {
    const label = labels.get(r.profile_id);
    const hollow = hollowByRecipient.get(r.id);
    return {
      id: r.id,
      profileId: r.profile_id,
      outlawLabel: label?.outlawLabel ?? "OUTLAW ——",
      displayName: label?.displayName ?? "unknown",
      walletAddressSnapshot: r.wallet_address_snapshot,
      eligibilitySource: r.eligibility_source,
      status: r.status,
      failureReason: r.failure_reason,
      hollowRewardId: hollow?.id ?? null,
      hollowStatus: hollow?.status ?? null,
      transactionHash: hollow?.transaction_hash ?? null,
      claimedAt: hollow?.claimed_at ?? null,
      sentAt: hollow?.sent_at ?? null,
    };
  });

  return {
    ...toListItem(campaign, gatheringTitle),
    assetContractAddress: campaign.asset_contract_address,
    createdByActorId: campaign.created_by_actor_id,
    recipients: views,
    serverNow: new Date().toISOString(),
  };
}
