import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { GreenwoodError } from "@/lib/greenwood/errors";
import {
  isMemberVisibleState,
  resolveGatheringStateFromRow,
} from "@/lib/greenwood/gatherings/state";
import type {
  FireGatheringsSnapshot,
  GatheringRow,
  SafeGathering,
  SafeGatheringDeedLink,
} from "@/lib/greenwood/gatherings/types";
import { assertProfileId } from "@/lib/leaf/validate";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function mapHandRpcError(message: string): GreenwoodError {
  if (message.includes("FENN_PROFILE_NOT_FOUND")) {
    return new GreenwoodError(
      "greenwood_gathering_failed",
      "Profile not found",
      404,
    );
  }
  if (message.includes("FENN_GREENWOOD_MEMBERSHIP_REQUIRED")) {
    return new GreenwoodError(
      "greenwood_membership_required",
      "Greenwood membership required",
      403,
    );
  }
  if (message.includes("FENN_GATHERING_NOT_FOUND")) {
    return new GreenwoodError(
      "greenwood_gathering_not_found",
      "Gathering not found",
      404,
    );
  }
  if (message.includes("FENN_GATHERING_CANCELLED")) {
    return new GreenwoodError(
      "greenwood_gathering_cancelled",
      "This Gathering was cancelled",
      409,
    );
  }
  if (message.includes("FENN_GATHERING_CLOSED")) {
    return new GreenwoodError(
      "greenwood_gathering_closed",
      "This Gathering has closed",
      409,
    );
  }
  if (message.includes("FENN_GATHERING_NOT_ACTIVE")) {
    return new GreenwoodError(
      "greenwood_gathering_not_active",
      "This Gathering is not active",
      409,
    );
  }
  if (message.includes("FENN_GATHERING_NOT_VISIBLE")) {
    return new GreenwoodError(
      "greenwood_gathering_not_visible",
      "This Gathering is not available",
      404,
    );
  }
  if (message.includes("FENN_GATHERING_FULL")) {
    return new GreenwoodError(
      "greenwood_gathering_full",
      "The Gathering is full",
      409,
    );
  }
  return new GreenwoodError(
    "greenwood_gathering_failed",
    "Gathering interaction failed",
    500,
  );
}

async function loadDeedLink(
  db: SupabaseClient,
  deedId: string | null,
): Promise<SafeGatheringDeedLink | null> {
  if (!deedId) return null;
  const { data, error } = await db
    .from("deeds")
    .select("id, slug, title")
    .eq("id", deedId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; slug: string | null; title: string };
  return { id: row.id, slug: row.slug, title: row.title };
}

async function countOpenHands(
  db: SupabaseClient,
  gatheringId: string,
): Promise<number> {
  const { count, error } = await db
    .from("greenwood_gathering_hands")
    .select("id", { count: "exact", head: true })
    .eq("gathering_id", gatheringId)
    .is("lowered_at", null);
  if (error) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Failed to count raised hands",
      500,
    );
  }
  return count ?? 0;
}

async function memberHasOpenHand(
  db: SupabaseClient,
  gatheringId: string,
  profileId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("greenwood_gathering_hands")
    .select("id")
    .eq("gathering_id", gatheringId)
    .eq("profile_id", profileId)
    .is("lowered_at", null)
    .maybeSingle();
  if (error) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Failed to load hand state",
      500,
    );
  }
  return data != null;
}

export async function toSafeGathering(
  row: GatheringRow,
  viewerProfileId: string,
  admin?: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<SafeGathering> {
  const db = admin ?? (await defaultAdmin());
  const resolved = resolveGatheringStateFromRow(row, nowMs);
  const handCount = await countOpenHands(db, row.id);
  const memberHasRaisedHand = await memberHasOpenHand(
    db,
    row.id,
    viewerProfileId,
  );
  const linkedDeed = await loadDeedLink(db, row.linked_deed_id);
  const active = resolved === "active";

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    resolvedState: resolved,
    interactionType: row.interaction_type,
    capacity: row.capacity,
    rewardLeafPreview: row.reward_leaf_preview,
    handCount,
    memberHasRaisedHand,
    canRaiseHand:
      active &&
      row.interaction_type === "raise_hand" &&
      !memberHasRaisedHand &&
      (row.capacity == null || handCount < row.capacity),
    canLowerHand:
      active &&
      row.interaction_type === "raise_hand" &&
      memberHasRaisedHand,
    linkedDeed,
    serverNow: new Date(nowMs).toISOString(),
  };
}

/**
 * Member Fire read model: active Gathering first, else next upcoming.
 * Drafts excluded. Closed/cancelled are not promoted as "upcoming".
 */
export async function getFireGatheringsSnapshot(
  viewerProfileId: string,
  admin?: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<FireGatheringsSnapshot> {
  const viewerId = assertProfileId(viewerProfileId);
  const db = admin ?? (await defaultAdmin());
  const serverNow = new Date(nowMs).toISOString();

  const { data, error } = await db
    .from("greenwood_gatherings")
    .select("*")
    .eq("location", "fire")
    .neq("status", "draft")
    .order("starts_at", { ascending: true });

  if (error) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Failed to load Gatherings",
      500,
    );
  }

  const rows = (data ?? []) as GatheringRow[];
  let active: SafeGathering | null = null;
  let upcoming: SafeGathering | null = null;

  for (const row of rows) {
    const resolved = resolveGatheringStateFromRow(row, nowMs);
    if (!isMemberVisibleState(resolved)) continue;
    if (resolved === "active") {
      active = await toSafeGathering(row, viewerId, db, nowMs);
      break;
    }
  }

  if (!active) {
    for (const row of rows) {
      const resolved = resolveGatheringStateFromRow(row, nowMs);
      if (resolved === "scheduled") {
        upcoming = await toSafeGathering(row, viewerId, db, nowMs);
        break;
      }
    }
  }

  return { active, upcoming, serverNow };
}

export async function raiseGatheringHand(
  gatheringId: string,
  profileId: string,
  admin?: SupabaseClient,
): Promise<SafeGathering> {
  const gId = assertProfileId(gatheringId);
  const pId = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { error } = await db.rpc("raise_greenwood_gathering_hand", {
    p_gathering_id: gId,
    p_profile_id: pId,
  });
  if (error) {
    throw mapHandRpcError(error.message ?? "");
  }

  const { data, error: loadError } = await db
    .from("greenwood_gatherings")
    .select("*")
    .eq("id", gId)
    .maybeSingle();
  if (loadError || !data) {
    throw new GreenwoodError(
      "greenwood_gathering_not_found",
      "Gathering not found",
      404,
    );
  }
  return toSafeGathering(data as GatheringRow, pId, db);
}

export async function lowerGatheringHand(
  gatheringId: string,
  profileId: string,
  admin?: SupabaseClient,
): Promise<SafeGathering> {
  const gId = assertProfileId(gatheringId);
  const pId = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { error } = await db.rpc("lower_greenwood_gathering_hand", {
    p_gathering_id: gId,
    p_profile_id: pId,
  });
  if (error) {
    throw mapHandRpcError(error.message ?? "");
  }

  const { data, error: loadError } = await db
    .from("greenwood_gatherings")
    .select("*")
    .eq("id", gId)
    .maybeSingle();
  if (loadError || !data) {
    throw new GreenwoodError(
      "greenwood_gathering_not_found",
      "Gathering not found",
      404,
    );
  }
  return toSafeGathering(data as GatheringRow, pId, db);
}
