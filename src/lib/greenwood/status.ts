import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { profileHasGreenwoodAccessOverride } from "@/lib/greenwood/access-wallets";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { computeGreenwoodStandingRank } from "@/lib/greenwood/ranking";
import {
  ensureMemberSigil,
  getProfileSigil,
} from "@/lib/greenwood/sigil/assignment";
import type { SafeGreenwoodSigil } from "@/lib/greenwood/sigil/types";
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
  greenwood_arrival_ceremony_completed_at: string | null;
  leaf_lifetime_earned: number | string | null;
  wallet_address: string;
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
      "greenwood_entered_at, greenwood_threshold_at_entry, greenwood_lifetime_leaf_at_entry, greenwood_arrival_ceremony_completed_at, leaf_lifetime_earned, wallet_address",
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
    return toMemberStatus(row, db, id);
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

  // Trusted wallet allowlist: eligibility only. LEAF numbers stay real.
  if (profileHasGreenwoodAccessOverride(row.wallet_address)) {
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

async function loadMemberRank(
  db: SupabaseClient,
  profileId: string,
): Promise<{ rank: number; total: number }> {
  const { data, error } = await db
    .from("profiles")
    .select("id, outlaw_number, leaf_lifetime_earned, greenwood_entered_at");

  if (error) {
    throw new GreenwoodError(
      "greenwood_status_failed",
      "Failed to load Greenwood standing rank",
      500,
    );
  }

  const rows = (data ?? []) as Array<{
    id: string;
    outlaw_number: number;
    leaf_lifetime_earned: number | string | null;
    greenwood_entered_at: string | null;
  }>;

  const members = rows
    .filter((r) => r.greenwood_entered_at != null)
    .map((r) => ({
      profileId: r.id,
      outlawNumber: assertSafeIntegerAmount(
        r.outlaw_number,
        "outlaw_number",
        "UNSAFE_BIGINT",
      ),
      leafLifetimeEarned: assertSafeIntegerAmount(
        r.leaf_lifetime_earned,
        "leaf_lifetime_earned",
        "UNSAFE_BIGINT",
      ),
    }));

  return computeGreenwoodStandingRank({ profileId, members });
}

async function toMemberStatus(
  row: GreenwoodProfileSnapshot,
  db: SupabaseClient,
  profileId: string,
): Promise<GreenwoodStatus> {
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

  const currentLifetimeLeaf = assertSafeIntegerAmount(
    row.leaf_lifetime_earned,
    "leaf_lifetime_earned",
    "UNSAFE_BIGINT",
  );
  const rank = await loadMemberRank(db, profileId);
  const sigil = await loadMemberSigil(profileId, db);

  return {
    state: "member",
    greenwoodEnteredAt: row.greenwood_entered_at as string,
    thresholdAtEntry,
    lifetimeLeafAtEntry,
    currentLifetimeLeaf,
    standingRank: rank.rank,
    standingTotalMembers: rank.total,
    sigil,
    arrivalCeremonyPending:
      row.greenwood_arrival_ceremony_completed_at == null,
  };
}

/**
 * Prefer existing assignment; lazily ensure if missing (ops recovery).
 * Never fails membership status — logs and returns null on assignment errors.
 */
async function loadMemberSigil(
  profileId: string,
  db: SupabaseClient,
): Promise<SafeGreenwoodSigil | null> {
  try {
    const existing = await getProfileSigil(profileId, db);
    if (existing) return existing;
    const ensured = await ensureMemberSigil(profileId, "system_status", db);
    return {
      slug: ensured.slug,
      asciiBody: ensured.asciiBody,
      a11yLabel: ensured.a11yLabel,
      width: ensured.width,
      height: ensured.height,
      isFallback: ensured.isFallback,
    };
  } catch (err) {
    const cause =
      err instanceof Error && err.cause && typeof err.cause === "object"
        ? err.cause
        : undefined;
    console.error(
      "[getGreenwoodStatus] sigil ensure failed; membership unchanged",
      {
        profileId,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message, code: (err as { code?: string }).code }
            : err,
        cause,
      },
    );
    return null;
  }
}
