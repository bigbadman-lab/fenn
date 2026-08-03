import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  INVITE_REWARD_CAP,
  INVITE_REWARD_PER,
} from "@/lib/invites/constants";
import type {
  DeskInviteSummary,
  OutlawInviteMemberSummary,
  OutlawInviteRecentArrival,
} from "@/lib/invites/types";
import { buildOutlawInviteUrl } from "@/lib/invites/urls";
import { formatOutlawNumber } from "@/lib/profiles/types";
import { createAdminClient } from "@/lib/supabase/admin";

const RECENT_LIMIT = 8;

type InviteRow = {
  id: string;
  status: string;
  reward_amount: number;
  created_at: string;
  invited_profile_id: string;
};

type ProfileSlim = {
  id: string;
  outlaw_number: number;
  invite_code: string;
};

async function loadInvitesForInviter(
  admin: SupabaseClient,
  inviterProfileId: string,
): Promise<InviteRow[]> {
  const { data, error } = await admin
    .from("outlaw_invites")
    .select("id, status, reward_amount, created_at, invited_profile_id")
    .eq("inviter_profile_id", inviterProfileId)
    .in("status", ["rewarded", "cap_reached", "registered"])
    .order("created_at", { ascending: false });

  if (error) {
    // Table may not exist pre-migration
    console.error("[outlaw_invites list]", error);
    return [];
  }

  return (data ?? []) as InviteRow[];
}

function summarizeRows(
  rows: InviteRow[],
): Omit<
  OutlawInviteMemberSummary,
  "inviteCode" | "inviteUrl" | "rewardPerInvite" | "rewardCap" | "recentArrivals"
> {
  const registeredInviteCount = rows.length;
  const rewardedInviteCount = rows.filter((r) => r.status === "rewarded").length;
  const inviteLeafGranted = rows.reduce(
    (sum, r) => sum + (Number(r.reward_amount) || 0),
    0,
  );
  const rewardedInvitesRemaining = Math.max(
    0,
    INVITE_REWARD_CAP - rewardedInviteCount,
  );

  return {
    registeredInviteCount,
    rewardedInviteCount,
    inviteLeafGranted,
    rewardedInvitesRemaining,
  };
}

async function recentArrivalsFromRows(
  admin: SupabaseClient,
  rows: InviteRow[],
): Promise<OutlawInviteRecentArrival[]> {
  const recent = rows.slice(0, RECENT_LIMIT);
  if (recent.length === 0) return [];

  const ids = recent.map((r) => r.invited_profile_id);
  const { data, error } = await admin
    .from("profiles")
    .select("id, outlaw_number")
    .in("id", ids);

  if (error) {
    console.error("[outlaw_invites recent profiles]", error);
    return [];
  }

  const byId = new Map(
    ((data ?? []) as Array<{ id: string; outlaw_number: number }>).map((p) => [
      p.id,
      p.outlaw_number,
    ]),
  );

  return recent.map((r) => {
    const n = byId.get(r.invited_profile_id);
    return {
      outlawLabel:
        n == null
          ? "OUTLAW —"
          : `OUTLAW ${formatOutlawNumber(Number(n))}`,
      arrivedAt: r.created_at,
      rewarded: r.status === "rewarded" && Number(r.reward_amount) > 0,
    };
  });
}

/**
 * Authenticated member invite summary for /outlaw.
 * Never exposes invitee private fields.
 *
 * When inviteCode is already known from a trusted profile load, skips
 * re-selecting the inviter profile for the code.
 */
export async function getOutlawInviteMemberSummary(input: {
  profileId: string;
  admin?: SupabaseClient;
  /** Trusted invite code — avoid second profile read when set. */
  inviteCode?: string | null;
}): Promise<OutlawInviteMemberSummary | null> {
  const admin = input.admin ?? createAdminClient();

  let inviteCode = input.inviteCode?.trim() ?? "";

  if (!inviteCode) {
    const { data: profile, error } = await admin
      .from("profiles")
      .select("id, outlaw_number, invite_code")
      .eq("id", input.profileId)
      .maybeSingle();

    if (error || !profile) {
      return null;
    }

    inviteCode = (profile as ProfileSlim).invite_code?.trim() ?? "";
  }

  if (!inviteCode) return null;

  const rows = await loadInvitesForInviter(admin, input.profileId);
  const stats = summarizeRows(rows);
  const recentArrivals = await recentArrivalsFromRows(admin, rows);

  return {
    inviteCode,
    inviteUrl: buildOutlawInviteUrl(inviteCode),
    rewardPerInvite: INVITE_REWARD_PER,
    rewardCap: INVITE_REWARD_CAP,
    ...stats,
    recentArrivals,
  };
}

/** Desk read-only invite summary for a member. */
export async function getDeskInviteSummary(input: {
  profileId: string;
  admin?: SupabaseClient;
}): Promise<DeskInviteSummary> {
  const admin = input.admin ?? createAdminClient();
  const rows = await loadInvitesForInviter(admin, input.profileId);
  const stats = summarizeRows(rows);
  const recentArrivals = await recentArrivalsFromRows(admin, rows);
  return {
    ...stats,
    recentArrivals,
  };
}
