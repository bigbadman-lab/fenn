import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DeskGatheringDetail,
  DeskGatheringFilter,
  DeskGatheringHand,
  DeskGatheringListItem,
} from "@/lib/desk/gatherings-types";
import {
  adminCancelGathering,
  adminCloseGathering,
  adminCreateGatheringDraft,
  adminGetGathering,
  adminListGatherings,
  adminPublishGathering,
  adminUpdateGatheringDraft,
  type CreateGatheringInput,
} from "@/lib/greenwood/gatherings/admin-ops";
import type { AdminGatheringListItem } from "@/lib/greenwood/gatherings/types";
import { DESK_CURRENT_SIGIL_MARK_SELECT } from "@/lib/greenwood/sigil/embeds";
import { assertProfileId, assertSafeIntegerAmount } from "@/lib/leaf/validate";
import { formatOutlawNumber } from "@/lib/profiles/types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

async function loadCampaignByGatheringIds(
  db: SupabaseClient,
  gatheringIds: string[],
): Promise<Map<string, { id: string; title: string; status: string }>> {
  const map = new Map<string, { id: string; title: string; status: string }>();
  if (gatheringIds.length === 0) return map;
  const { data, error } = await db
    .from("greenwood_reward_campaigns")
    .select("id, title, status, gathering_id")
    .in("gathering_id", gatheringIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const r = row as {
      id: string;
      title: string;
      status: string;
      gathering_id: string;
    };
    // Prefer first non-cancelled if multiple; otherwise first seen.
    const existing = map.get(r.gathering_id);
    if (!existing || existing.status === "cancelled") {
      map.set(r.gathering_id, {
        id: r.id,
        title: r.title,
        status: r.status,
      });
    }
  }
  return map;
}

function toDeskListItem(
  item: AdminGatheringListItem,
  campaign: { id: string; title: string; status: string } | null,
): DeskGatheringListItem {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    status: item.status,
    resolvedState: item.resolvedState,
    capacity: item.capacity,
    rewardLeafPreview: item.rewardLeafPreview,
    linkedDeedId: item.linkedDeedId,
    announcementStyle: item.announcementStyle,
    handCount: item.handCount,
    attendanceCount: item.attendanceCount,
    cancelledAt: item.cancelledAt,
    closedAt: item.closedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    rewardCampaign: campaign,
  };
}

function matchesFilter(
  item: DeskGatheringListItem,
  filter: DeskGatheringFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "draft":
      return item.resolvedState === "draft" || item.status === "draft";
    case "upcoming":
      return item.resolvedState === "scheduled";
    case "active":
      return item.resolvedState === "active";
    case "closed":
      return item.resolvedState === "closed";
    case "cancelled":
      return item.resolvedState === "cancelled";
    case "closed_hands_no_campaign":
      return (
        item.resolvedState === "closed" &&
        item.handCount > 0 &&
        item.rewardCampaign == null
      );
    default:
      return true;
  }
}

export async function listDeskGatherings(
  filter: DeskGatheringFilter = "all",
  nowMs: number = Date.now(),
): Promise<DeskGatheringListItem[]> {
  const db = await defaultAdmin();
  const items = await adminListGatherings(db, nowMs);
  const campaigns = await loadCampaignByGatheringIds(
    db,
    items.map((i) => i.id),
  );
  return items
    .map((item) => toDeskListItem(item, campaigns.get(item.id) ?? null))
    .filter((item) => matchesFilter(item, filter));
}

async function loadDeskHands(
  db: SupabaseClient,
  gatheringId: string,
): Promise<DeskGatheringHand[]> {
  const { data: handRows, error: handError } = await db
    .from("greenwood_gathering_hands")
    .select(
      `
      profile_id,
      raised_at,
      lowered_at,
      profiles!inner (
        outlaw_number,
        alias
      )
    `,
    )
    .eq("gathering_id", gatheringId)
    .order("raised_at", { ascending: false });

  if (handError) throw new Error(handError.message);

  const { data: attendanceRows, error: attError } = await db
    .from("greenwood_gathering_attendance")
    .select("profile_id, first_attended_at")
    .eq("gathering_id", gatheringId);
  if (attError) throw new Error(attError.message);

  const attendance = new Map<string, string>();
  for (const row of attendanceRows ?? []) {
    const r = row as { profile_id: string; first_attended_at: string };
    attendance.set(r.profile_id, r.first_attended_at);
  }

  const profileIds = (handRows ?? []).map(
    (h) => (h as { profile_id: string }).profile_id,
  );
  const sigilByProfile = new Map<
    string,
    { asciiBody: string; a11yLabel: string }
  >();
  if (profileIds.length > 0) {
    const { data: sigilRows, error: sigilError } = await db
      .from("greenwood_sigil_assignments")
      .select(DESK_CURRENT_SIGIL_MARK_SELECT)
      .in("profile_id", profileIds);
    if (sigilError) throw new Error(sigilError.message);
    for (const raw of sigilRows ?? []) {
      const r = raw as unknown as {
        profile_id: string;
        greenwood_sigil_catalogue:
          | { ascii_body: string; a11y_label: string }
          | { ascii_body: string; a11y_label: string }[]
          | null;
      };
      const cat = Array.isArray(r.greenwood_sigil_catalogue)
        ? r.greenwood_sigil_catalogue[0]
        : r.greenwood_sigil_catalogue;
      if (!cat) continue;
      sigilByProfile.set(r.profile_id, {
        asciiBody: cat.ascii_body,
        a11yLabel: cat.a11y_label,
      });
    }
  }

  return (
    (handRows ?? []) as unknown as Array<{
      profile_id: string;
      raised_at: string;
      lowered_at: string | null;
      profiles:
        | { outlaw_number: number | string; alias: string | null }
        | Array<{ outlaw_number: number | string; alias: string | null }>;
    }>
  ).map((h) => {
    const profile = Array.isArray(h.profiles) ? h.profiles[0] : h.profiles;
    const outlawNumber = profile
      ? assertSafeIntegerAmount(
          profile.outlaw_number,
          "outlaw_number",
          "UNSAFE_BIGINT",
        )
      : 0;
    const outlawLabel = formatOutlawNumber(outlawNumber);
    const alias = profile?.alias?.trim() || null;
    return {
      profileId: h.profile_id,
      displayName: alias ?? `Outlaw ${outlawLabel}`,
      outlawNumberLabel: outlawLabel,
      sigil: sigilByProfile.get(h.profile_id) ?? null,
      raisedAt: h.raised_at,
      loweredAt: h.lowered_at,
      isOpen: h.lowered_at == null,
      attended: attendance.has(h.profile_id),
      firstAttendedAt: attendance.get(h.profile_id) ?? null,
    };
  });
}

export async function getDeskGatheringDetail(
  gatheringId: string,
  nowMs: number = Date.now(),
): Promise<DeskGatheringDetail> {
  const id = assertProfileId(gatheringId);
  const db = await defaultAdmin();
  const gathering = await adminGetGathering(id, db, nowMs);
  const campaigns = await loadCampaignByGatheringIds(db, [id]);
  const hands = await loadDeskHands(db, id);
  const base = toDeskListItem(gathering, campaigns.get(id) ?? null);
  const openHandCount = hands.filter((h) => h.isOpen).length;
  return {
    ...base,
    cancellationReason: gathering.cancellationReason,
    linkedDeed: gathering.linkedDeed,
    hands,
    openHandCount,
    loweredHandCount: hands.length - openHandCount,
    serverNow: gathering.serverNow,
  };
}

export async function deskCreateGatheringDraft(
  input: CreateGatheringInput,
  actorId: string,
) {
  return adminCreateGatheringDraft(input, actorId);
}

export async function deskUpdateGatheringDraft(
  gatheringId: string,
  input: Partial<CreateGatheringInput>,
  actorId: string,
) {
  return adminUpdateGatheringDraft(gatheringId, input, actorId);
}

export async function deskPublishGathering(
  gatheringId: string,
  actorId: string,
) {
  return adminPublishGathering(gatheringId, actorId);
}

export async function deskCancelGathering(
  gatheringId: string,
  actorId: string,
  reason: string | null,
) {
  return adminCancelGathering(gatheringId, actorId, reason);
}

export async function deskCloseGathering(gatheringId: string, actorId: string) {
  return adminCloseGathering(gatheringId, actorId);
}
