import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { LeafError } from "@/lib/leaf/errors";
import type { StandingSnapshot } from "@/lib/leaf/types";
import {
  assertProfileId,
  assertSafeIntegerAmount,
} from "@/lib/leaf/validate";
import { getLeafLifetimeEarned } from "@/lib/leaf/reads";

const GREENWOOD_THRESHOLD_SETTING_KEY = "greenwood.lifetime_leaf_threshold";

async function readConfiguredGreenwoodThreshold(): Promise<number | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", GREENWOOD_THRESHOLD_SETTING_KEY)
    .maybeSingle();

  if (error) {
    throw new LeafError(
      "LEAF_READ_FAILED",
      "Failed to load standing settings",
      500,
    );
  }

  if (!data) return null;

  const raw = data.value;
  // Accept {"threshold": N} or a bare JSON number.
  const candidate =
    typeof raw === "number"
      ? raw
      : raw &&
          typeof raw === "object" &&
          !Array.isArray(raw) &&
          "threshold" in raw
        ? (raw as { threshold: unknown }).threshold
        : null;

  if (candidate == null) return null;

  try {
    const n = assertSafeIntegerAmount(
      candidate,
      "greenwoodThreshold",
      "UNSAFE_BIGINT",
    );
    if (n < 0) return null;
    return n;
  } catch {
    return null;
  }
}

/**
 * Standing foundation from lifetime LEAF only.
 * Does not invent rank names or default Greenwood thresholds.
 */
export async function getStandingSnapshot(
  profileIdOrLifetime: string | number,
): Promise<StandingSnapshot> {
  let lifetimeLeaf: number;

  if (typeof profileIdOrLifetime === "number") {
    lifetimeLeaf = assertSafeIntegerAmount(
      profileIdOrLifetime,
      "lifetimeLeaf",
      "UNSAFE_BIGINT",
    );
    if (lifetimeLeaf < 0) {
      throw new LeafError(
        "INVALID_AMOUNT",
        "lifetimeLeaf cannot be negative",
      );
    }
  } else {
    const profileId = assertProfileId(profileIdOrLifetime);
    lifetimeLeaf = await getLeafLifetimeEarned(profileId);
  }

  const greenwoodThreshold = await readConfiguredGreenwoodThreshold();

  return {
    lifetimeLeaf,
    greenwoodThreshold,
    meetsGreenwoodThreshold:
      greenwoodThreshold == null
        ? null
        : lifetimeLeaf >= greenwoodThreshold,
  };
}
