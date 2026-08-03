import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildUnstartedFirstThirtyProgress,
  mapRpcMilestone,
  progressFromRow,
  type FirstThirtyMilestoneEvent,
  type FirstThirtyProgressRow,
  type SafeFirstThirtyProgress,
} from "@/lib/first-thirty/types";
import { getStandingSnapshot } from "@/lib/leaf/standing";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type CampExchangeRpcRow = {
  active: boolean;
  completed: boolean;
  terminated: boolean;
  greenwood_open: boolean;
  eligible_camp_exchanges: number;
  first_camp_satisfied: boolean;
  third_camp_satisfied: boolean;
  first_deed_satisfied: boolean;
  onboarding_leaf_granted: number;
  lifetime_leaf: number | string;
  leaf_until_greenwood: number;
  next_milestone: string | null;
  counted: boolean;
  newly_satisfied_milestone: string | null;
  newly_satisfied: boolean;
  nominal_grant: number;
  actual_grant: number;
  first_thirty_suppressed_camp: boolean;
};

type FirstDeedRpcRow = {
  active: boolean;
  completed: boolean;
  terminated: boolean;
  greenwood_open: boolean;
  eligible_camp_exchanges: number;
  first_camp_satisfied: boolean;
  third_camp_satisfied: boolean;
  first_deed_satisfied: boolean;
  onboarding_leaf_granted: number;
  lifetime_leaf: number | string;
  leaf_until_greenwood: number;
  next_milestone: string | null;
  newly_satisfied_milestone: string | null;
  newly_satisfied: boolean;
  nominal_grant: number;
  actual_grant: number;
};

function safeFromRpcFlags(input: {
  active: boolean;
  completed: boolean;
  terminated: boolean;
  greenwoodOpen: boolean;
  eligibleCampExchanges: number;
  firstCamp: boolean;
  thirdCamp: boolean;
  firstDeed: boolean;
  onboardingLeafGranted: number;
  lifetimeLeaf: number;
  leafUntilGreenwood: number;
  nextMilestone: string | null;
  lastEvent?: FirstThirtyMilestoneEvent;
}): SafeFirstThirtyProgress {
  const active = input.active && !input.greenwoodOpen;

  let next: SafeFirstThirtyProgress["nextMilestone"] = null;
  if (active) {
    if (!input.firstCamp) next = "first_camp";
    else if (!input.thirdCamp) next = "third_camp";
    else if (!input.firstDeed) next = "first_deed";
  }

  return {
    active,
    completed: input.completed || (input.greenwoodOpen && input.firstCamp && input.thirdCamp && input.firstDeed),
    terminated:
      (!active && !input.completed && input.terminated) ||
      (input.greenwoodOpen && !(input.firstCamp && input.thirdCamp && input.firstDeed)),
    greenwoodOpen: input.greenwoodOpen,
    eligibleCampExchanges: Math.max(0, Math.trunc(input.eligibleCampExchanges)),
    milestones: {
      firstCamp: input.firstCamp,
      thirdCamp: input.thirdCamp,
      firstDeed: input.firstDeed,
    },
    milestoneLeafGranted: Math.max(0, Math.trunc(input.onboardingLeafGranted)),
    lifetimeLeaf: Math.max(0, Math.trunc(input.lifetimeLeaf)),
    leafUntilGreenwood: Math.max(0, Math.trunc(input.leafUntilGreenwood)),
    nextMilestone: next,
    ...(input.lastEvent ? { lastEvent: input.lastEvent } : {}),
  };
}

/**
 * Read First Thirty status without creating a progress row.
 * Uses progression row when present; otherwise pure unstarted derivation.
 */
export async function getFirstThirtyProgress(input: {
  profileId: string;
  isGreenwoodMember: boolean;
  admin?: SupabaseClient;
}): Promise<SafeFirstThirtyProgress> {
  const admin = input.admin ?? (await defaultAdmin());
  const standing = await getStandingSnapshot(input.profileId);
  const lifetimeLeaf = standing.lifetimeLeaf;
  const threshold =
    standing.greenwoodThreshold == null ? 30 : standing.greenwoodThreshold;

  const { data, error } = await admin
    .from("first_thirty_progress")
    .select(
      "profile_id, status, eligible_camp_exchange_count, first_camp_satisfied_at, third_camp_satisfied_at, first_deed_satisfied_at, first_camp_leaf_granted, third_camp_leaf_granted, first_deed_leaf_granted, onboarding_leaf_granted, finished_reason",
    )
    .eq("profile_id", input.profileId)
    .maybeSingle();

  if (error) {
    // Table may not exist pre-migration in some envs — fail soft to unstarted calc.
    return buildUnstartedFirstThirtyProgress({
      lifetimeLeaf,
      greenwoodThreshold: threshold,
      isGreenwoodMember: input.isGreenwoodMember,
    });
  }

  if (!data) {
    return buildUnstartedFirstThirtyProgress({
      lifetimeLeaf,
      greenwoodThreshold: threshold,
      isGreenwoodMember: input.isGreenwoodMember,
    });
  }

  return progressFromRow({
    row: data as FirstThirtyProgressRow,
    lifetimeLeaf,
    greenwoodThreshold: threshold,
    isGreenwoodMember: input.isGreenwoodMember,
  });
}

export type ApplyFirstThirtyCampResult = {
  progress: SafeFirstThirtyProgress;
  /** True while active — call site must skip grant_camp_message_reward. */
  suppressOrdinaryCampReward: boolean;
  lastEvent?: FirstThirtyMilestoneEvent;
};

/**
 * Count eligible CAMP exchange + milestone awards.
 * Creates progress row if needed and still under threshold.
 */
export async function applyFirstThirtyCampExchange(input: {
  assistantMessageId: string;
  admin?: SupabaseClient;
}): Promise<ApplyFirstThirtyCampResult> {
  const admin = input.admin ?? (await defaultAdmin());
  const { data, error } = await admin.rpc("apply_first_thirty_camp_exchange", {
    p_assistant_message_id: input.assistantMessageId,
  });

  if (error) {
    throw new Error(error.message ?? "first_thirty_camp_exchange_failed");
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | CampExchangeRpcRow
    | undefined;

  if (!row) {
    throw new Error("first_thirty_camp_exchange_empty");
  }

  const lifetimeLeaf = Number(row.lifetime_leaf ?? 0);
  const milestone = mapRpcMilestone(row.newly_satisfied_milestone);
  const lastEvent: FirstThirtyMilestoneEvent | undefined =
    row.newly_satisfied && milestone
      ? {
          milestone,
          newlySatisfied: true,
          nominalGrant: Math.max(0, Math.trunc(row.nominal_grant ?? 0)),
          actualGrant: Math.max(0, Math.trunc(row.actual_grant ?? 0)),
          greenwoodOpen: Boolean(row.greenwood_open),
        }
      : undefined;

  // Suppress only when RPC says active open path.
  const suppress = Boolean(row.first_thirty_suppressed_camp);

  const progress = safeFromRpcFlags({
    active: Boolean(row.active),
    completed: Boolean(row.completed),
    terminated: Boolean(row.terminated),
    greenwoodOpen: Boolean(row.greenwood_open),
    eligibleCampExchanges: Number(row.eligible_camp_exchanges ?? 0),
    firstCamp: Boolean(row.first_camp_satisfied),
    thirdCamp: Boolean(row.third_camp_satisfied),
    firstDeed: Boolean(row.first_deed_satisfied),
    onboardingLeafGranted: Number(row.onboarding_leaf_granted ?? 0),
    lifetimeLeaf,
    leafUntilGreenwood: Number(row.leaf_until_greenwood ?? 0),
    nextMilestone: row.next_milestone,
    lastEvent,
  });

  return {
    progress: {
      ...progress,
      // Align suppress flag with final progress.active
      active: progress.active && suppress,
      exchangeCounted: Boolean(row.counted),
    },
    suppressOrdinaryCampReward: suppress && progress.active,
    lastEvent,
  };
}

/**
 * After Deed approve LEAF: satisfy first_deed with remainder only.
 */
export async function applyFirstThirtyFirstDeed(input: {
  profileId: string;
  submissionId: string;
  admin?: SupabaseClient;
}): Promise<{
  progress: SafeFirstThirtyProgress;
  lastEvent?: FirstThirtyMilestoneEvent;
}> {
  const admin = input.admin ?? (await defaultAdmin());
  const { data, error } = await admin.rpc("apply_first_thirty_first_deed", {
    p_profile_id: input.profileId,
    p_submission_id: input.submissionId,
  });

  if (error) {
    throw new Error(error.message ?? "first_thirty_first_deed_failed");
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | FirstDeedRpcRow
    | undefined;

  if (!row) {
    throw new Error("first_thirty_first_deed_empty");
  }

  const lifetimeLeaf = Number(row.lifetime_leaf ?? 0);
  const milestone = mapRpcMilestone(row.newly_satisfied_milestone);
  const lastEvent: FirstThirtyMilestoneEvent | undefined =
    row.newly_satisfied && milestone
      ? {
          milestone,
          newlySatisfied: true,
          nominalGrant: Math.max(0, Math.trunc(row.nominal_grant ?? 0)),
          actualGrant: Math.max(0, Math.trunc(row.actual_grant ?? 0)),
          greenwoodOpen: Boolean(row.greenwood_open),
        }
      : undefined;

  return {
    progress: safeFromRpcFlags({
      active: Boolean(row.active),
      completed: Boolean(row.completed),
      terminated: Boolean(row.terminated),
      greenwoodOpen: Boolean(row.greenwood_open),
      eligibleCampExchanges: Number(row.eligible_camp_exchanges ?? 0),
      firstCamp: Boolean(row.first_camp_satisfied),
      thirdCamp: Boolean(row.third_camp_satisfied),
      firstDeed: Boolean(row.first_deed_satisfied),
      onboardingLeafGranted: Number(row.onboarding_leaf_granted ?? 0),
      lifetimeLeaf,
      leafUntilGreenwood: Number(row.leaf_until_greenwood ?? 0),
      nextMilestone: row.next_milestone,
      lastEvent,
    }),
    lastEvent,
  };
}
