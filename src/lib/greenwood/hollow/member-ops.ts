import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { GreenwoodError } from "@/lib/greenwood/errors";
import {
  explorerTxUrl,
  shortenWallet,
} from "@/lib/greenwood/hollow/explorer";
import {
  isMemberVisibleHollowStatus,
} from "@/lib/greenwood/hollow/state";
import type {
  HollowFireStatus,
  HollowInboxSnapshot,
  HollowRewardRow,
  SafeHollowReward,
} from "@/lib/greenwood/hollow/types";
import { assertProfileId, assertSafeIntegerAmount } from "@/lib/leaf/validate";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function numOrNull(value: number | string | null): number | null {
  if (value == null) return null;
  return assertSafeIntegerAmount(value, "amount", "UNSAFE_BIGINT");
}

export async function toSafeHollowReward(
  row: HollowRewardRow,
  opts: {
    campaignTitle?: string | null;
    gatheringTitle?: string | null;
    nowMs?: number;
  } = {},
): Promise<SafeHollowReward> {
  const nowMs = opts.nowMs ?? Date.now();
  const serverNow = new Date(nowMs).toISOString();
  const expired =
    row.expires_at != null && Date.parse(row.expires_at) <= nowMs;
  const status =
    row.status === "available" && expired ? "expired" : row.status;

  return {
    id: row.id,
    title: row.title,
    reason: row.reason,
    rewardType: row.reward_type,
    amount: numOrNull(row.amount),
    assetSymbol: row.asset_symbol,
    assetChainId: row.asset_chain_id,
    status,
    availableAt: row.available_at,
    expiresAt: row.expires_at,
    claimedAt: row.claimed_at,
    sentAt: row.sent_at,
    confirmedAt: row.confirmed_at,
    canClaim:
      row.reward_type === "leaf" &&
      status === "available" &&
      !expired,
    canAcknowledge:
      row.reward_type === "informational" && status === "available",
    walletShort: shortenWallet(row.wallet_address_snapshot),
    transactionHash: row.transaction_hash,
    explorerUrl: explorerTxUrl(row.asset_chain_id, row.transaction_hash),
    campaignTitle: opts.campaignTitle ?? null,
    gatheringTitle: opts.gatheringTitle ?? null,
    serverNow,
  };
}

async function loadCampaignTitles(
  db: SupabaseClient,
  campaignIds: string[],
): Promise<
  Map<string, { title: string; gatheringId: string | null; gatheringTitle: string | null }>
> {
  const map = new Map<
    string,
    { title: string; gatheringId: string | null; gatheringTitle: string | null }
  >();
  if (campaignIds.length === 0) return map;

  const { data, error } = await db
    .from("greenwood_reward_campaigns")
    .select("id, title, gathering_id")
    .in("id", campaignIds);
  if (error) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Failed to load campaigns",
      500,
    );
  }

  const gatheringIds = [
    ...new Set(
      ((data ?? []) as Array<{ gathering_id: string | null }>)
        .map((r) => r.gathering_id)
        .filter((id): id is string => id != null),
    ),
  ];
  const gatheringTitles = new Map<string, string>();
  if (gatheringIds.length > 0) {
    const { data: gatherings } = await db
      .from("greenwood_gatherings")
      .select("id, title")
      .in("id", gatheringIds);
    for (const g of (gatherings ?? []) as Array<{ id: string; title: string }>) {
      gatheringTitles.set(g.id, g.title);
    }
  }

  for (const row of (data ?? []) as Array<{
    id: string;
    title: string;
    gathering_id: string | null;
  }>) {
    map.set(row.id, {
      title: row.title,
      gatheringId: row.gathering_id,
      gatheringTitle: row.gathering_id
        ? (gatheringTitles.get(row.gathering_id) ?? null)
        : null,
    });
  }
  return map;
}

export async function getHollowInbox(
  profileId: string,
  admin?: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<HollowInboxSnapshot> {
  const viewerId = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());
  const serverNow = new Date(nowMs).toISOString();

  const { data, error } = await db
    .from("greenwood_hollow_rewards")
    .select("*")
    .eq("profile_id", viewerId)
    .neq("status", "draft")
    .order("available_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Failed to load The Hollow",
      500,
    );
  }

  const rows = ((data ?? []) as HollowRewardRow[]).filter((r) =>
    isMemberVisibleHollowStatus(r.status),
  );
  const campaignMeta = await loadCampaignTitles(
    db,
    [
      ...new Set(
        rows
          .map((r) => r.campaign_id)
          .filter((id): id is string => id != null),
      ),
    ],
  );

  const rewards: SafeHollowReward[] = [];
  for (const row of rows) {
    const meta = row.campaign_id
      ? campaignMeta.get(row.campaign_id)
      : undefined;
    rewards.push(
      await toSafeHollowReward(row, {
        campaignTitle: meta?.title ?? null,
        gatheringTitle: meta?.gatheringTitle ?? null,
        nowMs,
      }),
    );
  }

  return {
    rewards,
    availableCount: rewards.filter(
      (r) => r.canClaim || r.status === "awaiting_send" || r.status === "available",
    ).length,
    serverNow,
  };
}

export async function getHollowFireStatus(
  profileId: string,
  admin?: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<HollowFireStatus> {
  const inbox = await getHollowInbox(profileId, admin, nowMs);
  return {
    hasAvailable: inbox.rewards.some(
      (r) => r.canClaim || r.status === "available" || r.status === "awaiting_send",
    ),
    hasAny: inbox.rewards.length > 0,
    availableCount: inbox.availableCount,
    serverNow: inbox.serverNow,
  };
}

export async function getHollowRewardForMember(
  rewardId: string,
  profileId: string,
  admin?: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<SafeHollowReward> {
  const id = assertProfileId(rewardId);
  const viewerId = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { data, error } = await db
    .from("greenwood_hollow_rewards")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_hollow_not_found",
      "Nothing waits under that mark",
      404,
    );
  }
  const row = data as HollowRewardRow;
  if (row.profile_id !== viewerId) {
    throw new GreenwoodError(
      "greenwood_hollow_forbidden",
      "This is not yours to open",
      403,
    );
  }
  if (!isMemberVisibleHollowStatus(row.status)) {
    throw new GreenwoodError(
      "greenwood_hollow_not_found",
      "Nothing waits under that mark",
      404,
    );
  }

  let campaignTitle: string | null = null;
  let gatheringTitle: string | null = null;
  if (row.campaign_id) {
    const meta = await loadCampaignTitles(db, [row.campaign_id]);
    const m = meta.get(row.campaign_id);
    campaignTitle = m?.title ?? null;
    gatheringTitle = m?.gatheringTitle ?? null;
  }

  return toSafeHollowReward(row, { campaignTitle, gatheringTitle, nowMs });
}

export type HollowClaimResult = {
  reward: SafeHollowReward;
  leafBalance: number;
  leafLifetimeEarned: number;
  newlyClaimed: boolean;
};

function mapClaimError(message: string): GreenwoodError {
  if (message.includes("FENN_GREENWOOD_MEMBERSHIP_REQUIRED")) {
    return new GreenwoodError(
      "greenwood_membership_required",
      "Greenwood membership required",
      403,
    );
  }
  if (message.includes("FENN_HOLLOW_NOT_FOUND")) {
    return new GreenwoodError(
      "greenwood_hollow_not_found",
      "Nothing waits under that mark",
      404,
    );
  }
  if (message.includes("FENN_HOLLOW_FORBIDDEN")) {
    return new GreenwoodError(
      "greenwood_hollow_forbidden",
      "This is not yours to open",
      403,
    );
  }
  if (message.includes("FENN_HOLLOW_NOT_LEAF")) {
    return new GreenwoodError(
      "greenwood_hollow_not_claimable",
      "This reward cannot be claimed as LEAF",
      409,
    );
  }
  if (message.includes("FENN_HOLLOW_CANCELLED")) {
    return new GreenwoodError(
      "greenwood_hollow_cancelled",
      "This reward was cancelled",
      409,
    );
  }
  if (message.includes("FENN_HOLLOW_EXPIRED")) {
    return new GreenwoodError(
      "greenwood_hollow_expired",
      "This reward has expired",
      409,
    );
  }
  if (message.includes("FENN_HOLLOW_NOT_AVAILABLE")) {
    return new GreenwoodError(
      "greenwood_hollow_not_available",
      "This reward is not available",
      409,
    );
  }
  return new GreenwoodError(
    "greenwood_hollow_failed",
    "Hollow claim failed",
    500,
  );
}

export async function claimHollowLeaf(
  rewardId: string,
  profileId: string,
  admin?: SupabaseClient,
): Promise<HollowClaimResult> {
  const id = assertProfileId(rewardId);
  const viewerId = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { data, error } = await db.rpc("claim_greenwood_hollow_leaf", {
    p_reward_id: id,
    p_profile_id: viewerId,
  });

  if (error) {
    throw mapClaimError(error.message ?? "");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Hollow claim returned no result",
      500,
    );
  }

  const reward = await getHollowRewardForMember(id, viewerId, db);
  return {
    reward,
    leafBalance: assertSafeIntegerAmount(
      row.leaf_balance,
      "leaf_balance",
      "UNSAFE_BIGINT",
    ),
    leafLifetimeEarned: assertSafeIntegerAmount(
      row.leaf_lifetime_earned,
      "leaf_lifetime_earned",
      "UNSAFE_BIGINT",
    ),
    newlyClaimed: Boolean(row.newly_claimed),
  };
}

export async function acknowledgeHollowReward(
  rewardId: string,
  profileId: string,
  admin?: SupabaseClient,
): Promise<SafeHollowReward> {
  const id = assertProfileId(rewardId);
  const viewerId = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { data, error } = await db
    .from("greenwood_hollow_rewards")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_hollow_not_found",
      "Nothing waits under that mark",
      404,
    );
  }
  const row = data as HollowRewardRow;
  if (row.profile_id !== viewerId) {
    throw new GreenwoodError(
      "greenwood_hollow_forbidden",
      "This is not yours to open",
      403,
    );
  }
  if (row.reward_type !== "informational" || row.status !== "available") {
    throw new GreenwoodError(
      "greenwood_hollow_not_available",
      "This message cannot be acknowledged",
      409,
    );
  }

  const { error: updateError } = await db
    .from("greenwood_hollow_rewards")
    .update({ status: "acknowledged" })
    .eq("id", id)
    .eq("profile_id", viewerId)
    .eq("status", "available");
  if (updateError) {
    throw new GreenwoodError(
      "greenwood_hollow_failed",
      "Failed to acknowledge",
      500,
    );
  }

  if (row.campaign_recipient_id) {
    await db
      .from("greenwood_reward_campaign_recipients")
      .update({ status: "fulfilled" })
      .eq("id", row.campaign_recipient_id);
  }

  return getHollowRewardForMember(id, viewerId, db);
}
