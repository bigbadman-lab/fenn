import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { resolveGatheringStateFromRow } from "@/lib/greenwood/gatherings/state";
import type {
  AdminGatheringDetail,
  AdminGatheringHandRow,
  AdminGatheringListItem,
  GatheringAdminStatus,
  GatheringRow,
  SafeGatheringDeedLink,
} from "@/lib/greenwood/gatherings/types";
import { formatOutlawNumber } from "@/lib/profiles/types";
import { assertProfileId, assertSafeIntegerAmount } from "@/lib/leaf/validate";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "gathering"}-${suffix}`;
}

function mapDbError(message: string): GreenwoodError {
  if (
    message.includes("FENN_GATHERING_OVERLAP") ||
    message.includes("23P01") ||
    message.includes("overlapping")
  ) {
    return new GreenwoodError(
      "greenwood_gathering_overlap",
      "Another published Fire Gathering overlaps this window",
      409,
    );
  }
  if (message.includes("greenwood_gatherings_slug_uidx")) {
    return new GreenwoodError(
      "greenwood_gathering_failed",
      "Gathering slug already exists",
      409,
    );
  }
  return new GreenwoodError(
    "greenwood_gathering_failed",
    "Gathering admin operation failed",
    500,
  );
}

function validateWindow(startsAt: string, endsAt: string): void {
  const s = Date.parse(startsAt);
  const e = Date.parse(endsAt);
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Invalid Gathering times",
      400,
    );
  }
  if (e <= s) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "ends_at must be after starts_at",
      400,
    );
  }
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
      "Failed to count hands",
      500,
    );
  }
  return count ?? 0;
}

async function countAttendance(
  db: SupabaseClient,
  gatheringId: string,
): Promise<number> {
  const { count, error } = await db
    .from("greenwood_gathering_attendance")
    .select("profile_id", { count: "exact", head: true })
    .eq("gathering_id", gatheringId);
  if (error) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Failed to count attendance",
      500,
    );
  }
  return count ?? 0;
}

async function loadDeedLink(
  db: SupabaseClient,
  deedId: string | null,
): Promise<SafeGatheringDeedLink | null> {
  if (!deedId) return null;
  const { data } = await db
    .from("deeds")
    .select("id, slug, title")
    .eq("id", deedId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { id: string; slug: string | null; title: string };
  return { id: row.id, slug: row.slug, title: row.title };
}

async function toListItem(
  row: GatheringRow,
  db: SupabaseClient,
  nowMs: number,
): Promise<AdminGatheringListItem> {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    resolvedState: resolveGatheringStateFromRow(row, nowMs),
    interactionType: row.interaction_type,
    capacity: row.capacity,
    rewardLeafPreview: row.reward_leaf_preview,
    linkedDeedId: row.linked_deed_id,
    handCount: await countOpenHands(db, row.id),
    attendanceCount: await countAttendance(db, row.id),
    cancelledAt: row.cancelled_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CreateGatheringInput = {
  title: string;
  summary?: string;
  startsAt: string;
  endsAt: string;
  capacity?: number | null;
  rewardLeafPreview?: number | null;
  linkedDeedId?: string | null;
};

export async function adminListGatherings(
  admin?: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<AdminGatheringListItem[]> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("greenwood_gatherings")
    .select("*")
    .order("starts_at", { ascending: false });
  if (error) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Failed to list Gatherings",
      500,
    );
  }
  const rows = (data ?? []) as GatheringRow[];
  const out: AdminGatheringListItem[] = [];
  for (const row of rows) {
    out.push(await toListItem(row, db, nowMs));
  }
  return out;
}

export async function adminGetGathering(
  gatheringId: string,
  admin?: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<AdminGatheringDetail> {
  const id = assertProfileId(gatheringId);
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("greenwood_gatherings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_gathering_not_found",
      "Gathering not found",
      404,
    );
  }
  const row = data as GatheringRow;
  const base = await toListItem(row, db, nowMs);

  const { data: handRows, error: handError } = await db
    .from("greenwood_gathering_hands")
    .select(
      `
      raised_at,
      lowered_at,
      profiles!inner (
        outlaw_number,
        alias
      )
    `,
    )
    .eq("gathering_id", id)
    .order("raised_at", { ascending: false });

  if (handError) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Failed to load hands",
      500,
    );
  }

  const hands: AdminGatheringHandRow[] = (
    (handRows ?? []) as unknown as Array<{
      raised_at: string;
      lowered_at: string | null;
      profiles:
        | { outlaw_number: number | string; alias: string | null }
        | Array<{ outlaw_number: number | string; alias: string | null }>;
    }>
  ).map((h) => {
    const profile = Array.isArray(h.profiles) ? h.profiles[0] : h.profiles;
    if (!profile) {
      return {
        outlawLabel: "OUTLAW ——",
        displayName: "OUTLAW ——",
        raisedAt: h.raised_at,
        loweredAt: h.lowered_at,
        isOpen: h.lowered_at == null,
      };
    }
    const outlawNumber = assertSafeIntegerAmount(
      profile.outlaw_number,
      "outlaw_number",
      "UNSAFE_BIGINT",
    );
    const outlawLabel = `OUTLAW ${formatOutlawNumber(outlawNumber)}`;
    const alias = profile.alias?.trim() || null;
    return {
      outlawLabel,
      displayName: alias ?? outlawLabel,
      raisedAt: h.raised_at,
      loweredAt: h.lowered_at,
      isOpen: h.lowered_at == null,
    };
  });

  return {
    ...base,
    cancellationReason: row.cancellation_reason,
    createdByActorId: row.created_by_actor_id,
    hands,
    linkedDeed: await loadDeedLink(db, row.linked_deed_id),
    serverNow: new Date(nowMs).toISOString(),
  };
}

export async function adminCreateGatheringDraft(
  input: CreateGatheringInput,
  actorId: string,
  admin?: SupabaseClient,
): Promise<AdminGatheringListItem> {
  const db = admin ?? (await defaultAdmin());
  const title = input.title.trim();
  if (!title) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Title is required",
      400,
    );
  }
  validateWindow(input.startsAt, input.endsAt);

  const rowInsert = {
    title,
    slug: slugify(title),
    summary: (input.summary ?? "").trim(),
    location: "fire",
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    status: "draft" as GatheringAdminStatus,
    interaction_type: "raise_hand",
    capacity: input.capacity ?? null,
    reward_leaf_preview: input.rewardLeafPreview ?? null,
    linked_deed_id: input.linkedDeedId ?? null,
    created_by_actor_id: actorId,
  };

  const { data, error } = await db
    .from("greenwood_gatherings")
    .insert(rowInsert)
    .select("*")
    .maybeSingle();

  if (error || !data) {
    throw mapDbError(error?.message ?? "");
  }

  const row = data as GatheringRow;
  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.gathering.create",
    entityType: "greenwood_gathering",
    entityId: row.id,
    afterState: { status: row.status, starts_at: row.starts_at, ends_at: row.ends_at },
  });

  return toListItem(row, db, Date.now());
}

export async function adminUpdateGatheringDraft(
  gatheringId: string,
  input: Partial<CreateGatheringInput>,
  actorId: string,
  admin?: SupabaseClient,
): Promise<AdminGatheringListItem> {
  const id = assertProfileId(gatheringId);
  const db = admin ?? (await defaultAdmin());
  const { data: existing, error: loadError } = await db
    .from("greenwood_gatherings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !existing) {
    throw new GreenwoodError(
      "greenwood_gathering_not_found",
      "Gathering not found",
      404,
    );
  }
  const before = existing as GatheringRow;
  if (before.status !== "draft") {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Only draft Gatherings can be edited",
      409,
    );
  }

  const startsAt = input.startsAt ?? before.starts_at;
  const endsAt = input.endsAt ?? before.ends_at;
  validateWindow(startsAt, endsAt);

  const patch: Record<string, unknown> = {};
  if (input.title != null) patch.title = input.title.trim();
  if (input.summary != null) patch.summary = input.summary.trim();
  if (input.startsAt != null) patch.starts_at = input.startsAt;
  if (input.endsAt != null) patch.ends_at = input.endsAt;
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (input.rewardLeafPreview !== undefined) {
    patch.reward_leaf_preview = input.rewardLeafPreview;
  }
  if (input.linkedDeedId !== undefined) {
    patch.linked_deed_id = input.linkedDeedId;
  }

  const { data, error } = await db
    .from("greenwood_gatherings")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    throw mapDbError(error?.message ?? "");
  }
  const row = data as GatheringRow;
  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.gathering.update",
    entityType: "greenwood_gathering",
    entityId: row.id,
    beforeState: { status: before.status, starts_at: before.starts_at, ends_at: before.ends_at },
    afterState: { status: row.status, starts_at: row.starts_at, ends_at: row.ends_at },
  });
  return toListItem(row, db, Date.now());
}

export async function adminPublishGathering(
  gatheringId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<AdminGatheringListItem> {
  const id = assertProfileId(gatheringId);
  const db = admin ?? (await defaultAdmin());
  const { data: existing, error: loadError } = await db
    .from("greenwood_gatherings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !existing) {
    throw new GreenwoodError(
      "greenwood_gathering_not_found",
      "Gathering not found",
      404,
    );
  }
  const before = existing as GatheringRow;
  if (before.status !== "draft" && before.status !== "scheduled") {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Only draft Gatherings can be published",
      409,
    );
  }
  validateWindow(before.starts_at, before.ends_at);

  const { data, error } = await db
    .from("greenwood_gatherings")
    .update({ status: "scheduled" })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    throw mapDbError(error?.message ?? "");
  }
  const row = data as GatheringRow;
  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.gathering.publish",
    entityType: "greenwood_gathering",
    entityId: row.id,
    beforeState: { status: before.status },
    afterState: { status: row.status },
  });
  return toListItem(row, db, Date.now());
}

export async function adminCancelGathering(
  gatheringId: string,
  actorId: string,
  reason: string | null,
  admin?: SupabaseClient,
): Promise<AdminGatheringListItem> {
  const id = assertProfileId(gatheringId);
  const db = admin ?? (await defaultAdmin());
  const { data: existing, error: loadError } = await db
    .from("greenwood_gatherings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !existing) {
    throw new GreenwoodError(
      "greenwood_gathering_not_found",
      "Gathering not found",
      404,
    );
  }
  const before = existing as GatheringRow;
  if (before.status === "cancelled") {
    return toListItem(before, db, Date.now());
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("greenwood_gatherings")
    .update({
      status: "cancelled",
      cancelled_at: now,
      cancellation_reason: reason?.trim() || null,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    throw mapDbError(error?.message ?? "");
  }
  const row = data as GatheringRow;
  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.gathering.cancel",
    entityType: "greenwood_gathering",
    entityId: row.id,
    beforeState: { status: before.status },
    afterState: { status: row.status, cancelled_at: row.cancelled_at },
    reason,
  });
  return toListItem(row, db, Date.now());
}

export async function adminCloseGathering(
  gatheringId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<AdminGatheringListItem> {
  const id = assertProfileId(gatheringId);
  const db = admin ?? (await defaultAdmin());
  const { data: existing, error: loadError } = await db
    .from("greenwood_gatherings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !existing) {
    throw new GreenwoodError(
      "greenwood_gathering_not_found",
      "Gathering not found",
      404,
    );
  }
  const before = existing as GatheringRow;
  if (before.status === "cancelled") {
    throw new GreenwoodError(
      "greenwood_gathering_cancelled",
      "Cancelled Gatherings cannot be closed",
      409,
    );
  }
  if (before.status === "draft") {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Draft Gatherings cannot be closed",
      409,
    );
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("greenwood_gatherings")
    .update({
      status: "closed",
      closed_at: now,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    throw mapDbError(error?.message ?? "");
  }
  const row = data as GatheringRow;
  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.gathering.close",
    entityType: "greenwood_gathering",
    entityId: row.id,
    beforeState: { status: before.status },
    afterState: { status: row.status, closed_at: row.closed_at },
  });
  return toListItem(row, db, Date.now());
}
