import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { GreenwoodError } from "@/lib/greenwood/errors";
import type { GreenwoodStatus } from "@/lib/greenwood/types";
import { LeafError } from "@/lib/leaf/errors";
import type { StandingSnapshot } from "@/lib/leaf/types";
import { assertProfileId, assertSafeIntegerAmount } from "@/lib/leaf/validate";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

async function defaultStandingLoader(
  profileId: string,
): Promise<StandingSnapshot> {
  const { getStandingSnapshot } = await import("@/lib/leaf/standing");
  return getStandingSnapshot(profileId);
}

type GreenwoodProfileSnapshot = {
  greenwood_entered_at: string | null;
  greenwood_threshold_at_entry: number | null;
  greenwood_lifetime_leaf_at_entry: number | string | null;
};

export type GreenwoodStandingLoader = (
  profileId: string,
) => Promise<StandingSnapshot>;

/**
 * Authoritative Greenwood status for a registered profile.
 * Membership (frozen snapshot) takes precedence over current threshold.
 * Does not mutate. Does not invent a default threshold.
 */
export async function getGreenwoodStatus(
  profileId: string,
  admin?: SupabaseClient,
  loadStanding: GreenwoodStandingLoader = defaultStandingLoader,
): Promise<GreenwoodStatus> {
  const id = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { data, error } = await db
    .from("profiles")
    .select(
      "greenwood_entered_at, greenwood_threshold_at_entry, greenwood_lifetime_leaf_at_entry",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new GreenwoodError(
      "greenwood_status_failed",
      "Failed to load Greenwood membership",
      500,
    );
  }
  if (!data) {
    throw new GreenwoodError(
      "greenwood_status_failed",
      "Profile not found",
      404,
    );
  }

  const row = data as GreenwoodProfileSnapshot;

  if (row.greenwood_entered_at != null) {
    return toMemberStatus(row);
  }

  // Non-member: reuse Stage 4 standing (lifetime + configured threshold).
  let standing: StandingSnapshot;
  try {
    standing = await loadStanding(id);
  } catch (err) {
    if (err instanceof LeafError) {
      throw new GreenwoodError(
        "greenwood_status_failed",
        "Failed to load Greenwood standing",
        err.status >= 400 ? err.status : 500,
      );
    }
    throw err;
  }

  if (
    standing.greenwoodThreshold == null ||
    standing.meetsGreenwoodThreshold == null
  ) {
    throw new GreenwoodError(
      "greenwood_configuration_error",
      "Greenwood threshold is not configured",
      503,
    );
  }

  const lifetimeLeaf = standing.lifetimeLeaf;
  const threshold = standing.greenwoodThreshold;
  const remainingLeaf = Math.max(0, threshold - lifetimeLeaf);

  if (standing.meetsGreenwoodThreshold) {
    return {
      state: "eligible",
      lifetimeLeaf,
      threshold,
      remainingLeaf: 0,
      greenwoodEnteredAt: null,
    };
  }

  return {
    state: "ineligible",
    lifetimeLeaf,
    threshold,
    remainingLeaf,
    greenwoodEnteredAt: null,
  };
}

function toMemberStatus(row: GreenwoodProfileSnapshot): GreenwoodStatus {
  if (
    row.greenwood_threshold_at_entry == null ||
    row.greenwood_lifetime_leaf_at_entry == null
  ) {
    throw new GreenwoodError(
      "greenwood_profile_corrupt",
      "Greenwood admission snapshot is incomplete",
      500,
    );
  }

  let thresholdAtEntry: number;
  let lifetimeLeafAtEntry: number;
  try {
    thresholdAtEntry = assertSafeIntegerAmount(
      row.greenwood_threshold_at_entry,
      "greenwood_threshold_at_entry",
      "UNSAFE_BIGINT",
    );
    lifetimeLeafAtEntry = assertSafeIntegerAmount(
      row.greenwood_lifetime_leaf_at_entry,
      "greenwood_lifetime_leaf_at_entry",
      "UNSAFE_BIGINT",
    );
  } catch (err) {
    if (err instanceof LeafError) {
      throw new GreenwoodError(
        "greenwood_profile_corrupt",
        "Greenwood admission snapshot is invalid",
        500,
      );
    }
    throw err;
  }

  return {
    state: "member",
    greenwoodEnteredAt: row.greenwood_entered_at as string,
    thresholdAtEntry,
    lifetimeLeafAtEntry,
  };
}
