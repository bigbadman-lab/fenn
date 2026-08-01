import type {
  CampaignStatus,
  HollowRewardStatus,
  HollowRewardType,
} from "@/lib/greenwood/hollow/types";

const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> =
  {
    draft: ["resolved", "cancelled"],
    resolved: ["available", "cancelled"],
    available: ["executing", "completed", "completed_partial", "cancelled"],
    executing: ["completed", "completed_partial", "available"],
    completed: [],
    completed_partial: [],
    cancelled: [],
  };

const LEAF_TRANSITIONS: Record<string, readonly HollowRewardStatus[]> = {
  draft: ["available", "cancelled"],
  available: ["claimed", "expired", "cancelled", "failed"],
  claimed: [],
  expired: [],
  cancelled: [],
  failed: [],
};

const ONCHAIN_TRANSITIONS: Record<string, readonly HollowRewardStatus[]> = {
  draft: ["awaiting_send", "cancelled"],
  awaiting_send: ["sent", "failed", "cancelled"],
  sent: ["confirmed", "failed"],
  confirmed: [],
  failed: [],
  cancelled: [],
};

const INFO_TRANSITIONS: Record<string, readonly HollowRewardStatus[]> = {
  draft: ["available", "cancelled"],
  available: ["acknowledged", "expired", "cancelled"],
  acknowledged: [],
  expired: [],
  cancelled: [],
};

export function canTransitionCampaign(
  from: CampaignStatus,
  to: CampaignStatus,
): boolean {
  if (from === to) return true;
  return CAMPAIGN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertCampaignTransition(
  from: CampaignStatus,
  to: CampaignStatus,
): void {
  if (!canTransitionCampaign(from, to)) {
    throw new Error(`Invalid campaign transition ${from} → ${to}`);
  }
}

export function canTransitionHollow(
  rewardType: HollowRewardType,
  from: HollowRewardStatus,
  to: HollowRewardStatus,
): boolean {
  if (from === to) return true;
  const table =
    rewardType === "leaf"
      ? LEAF_TRANSITIONS
      : rewardType === "informational"
        ? INFO_TRANSITIONS
        : ONCHAIN_TRANSITIONS;
  return table[from]?.includes(to) ?? false;
}

export function availableStatusForType(
  rewardType: HollowRewardType,
): HollowRewardStatus {
  if (rewardType === "eth" || rewardType === "erc20") return "awaiting_send";
  return "available";
}

export function isTerminalHollowStatus(status: HollowRewardStatus): boolean {
  return (
    status === "claimed" ||
    status === "confirmed" ||
    status === "acknowledged" ||
    status === "expired" ||
    status === "cancelled" ||
    status === "failed"
  );
}

export function isMemberVisibleHollowStatus(
  status: HollowRewardStatus,
): boolean {
  return status !== "draft" && status !== "cancelled";
}
