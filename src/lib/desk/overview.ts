import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { previousUtcCalendarDay } from "@/lib/chronicle/dates";
import { findDailyChronicleByCoveredDate } from "@/lib/chronicle/read";
import type {
  DeskAttentionSignal,
  DeskOverviewSnapshot,
} from "@/lib/desk/overview-types";
import { resolveGatheringStateFromRow } from "@/lib/greenwood/gatherings/state";
import type { GatheringRow } from "@/lib/greenwood/gatherings/types";
import { isFirePresenceActive } from "@/lib/greenwood/presence/filter";
import { getPublicTreasurySnapshot } from "@/lib/treasury/snapshot";
import { X_OAUTH_CREDENTIAL_SLOT } from "@/lib/agent/execute-config";

/** Active Gathering ending within this window is "soon". */
export const DESK_GATHERING_ENDING_SOON_MS = 30 * 60 * 1000;

type SourceResult<T> =
  | { ok: true; value: T }
  | { ok: false };

async function settle<T>(fn: () => Promise<T>): Promise<SourceResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch {
    return { ok: false };
  }
}

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type PendingDeedsSlice = {
  count: number;
  oldestId: string | null;
};

async function loadPendingDeeds(db: SupabaseClient): Promise<PendingDeedsSlice> {
  const { count, error } = await db
    .from("deed_submissions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw new Error(error.message);

  let oldestId: string | null = null;
  if ((count ?? 0) > 0) {
    const { data, error: oldestError } = await db
      .from("deed_submissions")
      .select("id")
      .eq("status", "pending")
      .order("submitted_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (oldestError) throw new Error(oldestError.message);
    oldestId = typeof data?.id === "string" ? data.id : null;
  }

  return { count: count ?? 0, oldestId };
}

type GatheringSlice = {
  active: Array<{ id: string; title: string; endsAt: string; handCount: number }>;
  upcoming: Array<{ id: string; title: string; startsAt: string }>;
  endingSoon: Array<{ id: string; title: string; endsAt: string }>;
  closedHandsWithoutCampaign: Array<{
    id: string;
    title: string;
    handCount: number;
  }>;
};

async function loadGatheringSlice(
  db: SupabaseClient,
  nowMs: number,
): Promise<GatheringSlice> {
  const { data, error } = await db
    .from("greenwood_gatherings")
    .select("*")
    .order("starts_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as GatheringRow[];
  const gatheringIds = rows.map((r) => r.id);

  const handCounts = new Map<string, number>();
  if (gatheringIds.length > 0) {
    const { data: hands, error: handsError } = await db
      .from("greenwood_gathering_hands")
      .select("gathering_id")
      .in("gathering_id", gatheringIds)
      .is("lowered_at", null);
    if (handsError) throw new Error(handsError.message);
    for (const hand of hands ?? []) {
      const gid = String((hand as { gathering_id: string }).gathering_id);
      handCounts.set(gid, (handCounts.get(gid) ?? 0) + 1);
    }
  }

  const { data: campaigns, error: campError } = await db
    .from("greenwood_reward_campaigns")
    .select("gathering_id")
    .not("gathering_id", "is", null);
  if (campError) throw new Error(campError.message);
  const campaignGatherings = new Set(
    (campaigns ?? [])
      .map((c) => (c as { gathering_id: string | null }).gathering_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const slice: GatheringSlice = {
    active: [],
    upcoming: [],
    endingSoon: [],
    closedHandsWithoutCampaign: [],
  };

  for (const row of rows) {
    const resolved = resolveGatheringStateFromRow(row, nowMs);
    const handCount = handCounts.get(row.id) ?? 0;
    if (resolved === "active") {
      slice.active.push({
        id: row.id,
        title: row.title,
        endsAt: row.ends_at,
        handCount,
      });
      const remaining = Date.parse(row.ends_at) - nowMs;
      if (
        Number.isFinite(remaining) &&
        remaining > 0 &&
        remaining <= DESK_GATHERING_ENDING_SOON_MS
      ) {
        slice.endingSoon.push({
          id: row.id,
          title: row.title,
          endsAt: row.ends_at,
        });
      }
    } else if (resolved === "scheduled") {
      slice.upcoming.push({
        id: row.id,
        title: row.title,
        startsAt: row.starts_at,
      });
    } else if (resolved === "closed" && handCount > 0) {
      if (!campaignGatherings.has(row.id)) {
        slice.closedHandsWithoutCampaign.push({
          id: row.id,
          title: row.title,
          handCount,
        });
      }
    }
  }

  return slice;
}

type HollowSlice = {
  draftOrResolved: number;
  partialOrFailedCampaigns: number;
  unclaimedLeaf: number;
  failedRewards: number;
};

async function loadHollowSlice(db: SupabaseClient): Promise<HollowSlice> {
  const { data: campaigns, error } = await db
    .from("greenwood_reward_campaigns")
    .select("id, status, reward_type")
    .in("status", [
      "draft",
      "resolved",
      "available",
      "executing",
      "completed_partial",
    ]);
  if (error) throw new Error(error.message);

  let draftOrResolved = 0;
  let partialOrFailedCampaigns = 0;
  for (const row of campaigns ?? []) {
    const status = String((row as { status: string }).status);
    if (status === "draft" || status === "resolved") draftOrResolved += 1;
    if (status === "completed_partial") partialOrFailedCampaigns += 1;
  }

  const { count: unclaimedLeaf, error: leafError } = await db
    .from("greenwood_hollow_rewards")
    .select("id", { count: "exact", head: true })
    .eq("reward_type", "leaf")
    .eq("status", "available");
  if (leafError) throw new Error(leafError.message);

  const { count: failedRewards, error: failError } = await db
    .from("greenwood_hollow_rewards")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed");
  if (failError) throw new Error(failError.message);

  return {
    draftOrResolved,
    partialOrFailedCampaigns,
    unclaimedLeaf: unclaimedLeaf ?? 0,
    failedRewards: failedRewards ?? 0,
  };
}

async function countActiveFire(db: SupabaseClient, nowMs: number): Promise<number> {
  const { data, error } = await db
    .from("greenwood_presence")
    .select("profile_id, last_seen_at, sitting, profiles!inner(greenwood_entered_at)")
    .not("profiles.greenwood_entered_at", "is", null);
  if (error) throw new Error(error.message);

  let count = 0;
  for (const row of data ?? []) {
    const lastSeen = (row as { last_seen_at: string }).last_seen_at;
    if (isFirePresenceActive(lastSeen, nowMs)) count += 1;
  }
  return count;
}

type BookSlice = {
  yesterdayMissing: boolean;
  recentGapCount: number;
};

async function loadBookSlice(): Promise<BookSlice> {
  const yesterday = previousUtcCalendarDay();
  const entry = await findDailyChronicleByCoveredDate(yesterday);
  let recentGapCount = entry == null ? 1 : 0;
  // Count gaps for the prior 6 UTC days before yesterday.
  for (let i = 1; i <= 6; i += 1) {
    const dt = new Date(`${yesterday}T00:00:00.000Z`);
    dt.setUTCDate(dt.getUTCDate() - i);
    const day = dt.toISOString().slice(0, 10);
    const dayEntry = await findDailyChronicleByCoveredDate(day);
    if (dayEntry == null) recentGapCount += 1;
  }
  return {
    yesterdayMissing: entry == null,
    recentGapCount,
  };
}

type TreasurySlice = {
  state: "ready" | "unavailable" | "unconfigured" | "partial";
};

async function loadTreasurySlice(): Promise<TreasurySlice> {
  const snap = await getPublicTreasurySnapshot();
  if (snap.state === "unconfigured") return { state: "unconfigured" };
  if (snap.state === "unavailable") return { state: "unavailable" };
  const partial = snap.assets.some((a) => a.state === "unavailable");
  return { state: partial ? "partial" : "ready" };
}

type AgentSlice = {
  oauthUnbound: boolean;
  failedEffects: number;
  stuckProcessing: number;
  pendingBacklog: number;
  noRecentPoll: boolean;
};

async function loadAgentSlice(db: SupabaseClient): Promise<AgentSlice> {
  const { data: oauth, error: oauthError } = await db
    .from("x_oauth_credentials")
    .select("id")
    .eq("slot", X_OAUTH_CREDENTIAL_SLOT)
    .maybeSingle();
  if (oauthError) throw new Error(oauthError.message);

  const { count: failedEffects, error: failError } = await db
    .from("x_perception_effects")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed");
  if (failError) throw new Error(failError.message);

  const { count: stuckEffects, error: stuckError } = await db
    .from("x_perception_effects")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing");
  if (stuckError) throw new Error(stuckError.message);

  const { count: stuckPerceptions, error: stuckPError } = await db
    .from("x_perception_events")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing");
  if (stuckPError) throw new Error(stuckPError.message);

  const { count: pendingEffects, error: pendingEError } = await db
    .from("x_perception_effects")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (pendingEError) throw new Error(pendingEError.message);

  const { count: pendingPerceptions, error: pendingPError } = await db
    .from("x_perception_events")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (pendingPError) throw new Error(pendingPError.message);

  const { data: poll } = await db
    .from("x_poll_state")
    .select("updated_at")
    .eq("key", "mentions_askfenn")
    .maybeSingle();
  const updatedAt =
    typeof poll?.updated_at === "string" ? Date.parse(poll.updated_at) : NaN;
  const noRecentPoll =
    !Number.isFinite(updatedAt) || Date.now() - updatedAt > 24 * 60 * 60 * 1000;

  return {
    oauthUnbound: oauth == null,
    failedEffects: failedEffects ?? 0,
    stuckProcessing: (stuckEffects ?? 0) + (stuckPerceptions ?? 0),
    pendingBacklog: (pendingEffects ?? 0) + (pendingPerceptions ?? 0),
    noRecentPoll,
  };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Bounded Desk overview. Partial subsystem failures become unavailable signals
 * rather than inventing health or exposing raw errors.
 */
export async function getDeskOverview(
  nowMs: number = Date.now(),
): Promise<DeskOverviewSnapshot> {
  const db = await defaultAdmin();
  const signals: DeskAttentionSignal[] = [];
  let allSourcesOk = true;

  const pending = await settle(() => loadPendingDeeds(db));
  if (!pending.ok) {
    allSourcesOk = false;
    signals.push({
      id: "deeds_pending",
      category: "needs_attention",
      message: "Deed review could not be checked.",
      count: null,
      href: "/desk/deeds",
      availability: "unavailable",
    });
  } else if (pending.value.count > 0) {
    signals.push({
      id: "deeds_pending",
      category: "needs_attention",
      message: `${pending.value.count} ${plural(pending.value.count, "Deed awaits", "Deeds await")} review.`,
      count: pending.value.count,
      href: pending.value.oldestId
        ? `/desk/deeds/${pending.value.oldestId}`
        : "/desk/deeds",
      availability: "ok",
    });
  }

  const gatherings = await settle(() => loadGatheringSlice(db, nowMs));
  if (!gatherings.ok) {
    allSourcesOk = false;
    signals.push({
      id: "gatherings",
      category: "needs_attention",
      message: "Gathering state could not be checked.",
      count: null,
      href: null,
      availability: "unavailable",
    });
  } else {
    const g = gatherings.value;
    for (const item of g.closedHandsWithoutCampaign) {
      signals.push({
        id: `gathering_closed_hands_${item.id}`,
        category: "needs_attention",
        message: `${item.handCount} ${plural(item.handCount, "hand remains", "hands remain")} raised on a closed Gathering with no reward campaign.`,
        count: item.handCount,
        href: `/desk/gatherings/${item.id}`,
        availability: "ok",
      });
    }
    for (const item of g.active) {
      signals.push({
        id: `gathering_active_${item.id}`,
        category: "happening_now",
        message:
          item.handCount > 0
            ? `One Gathering is active. ${item.handCount} ${plural(item.handCount, "hand is", "hands are")} raised.`
            : "One Gathering is active.",
        count: 1,
        href: "/desk/gatherings",
        availability: "ok",
      });
    }
    for (const item of g.endingSoon) {
      signals.push({
        id: `gathering_ending_${item.id}`,
        category: "soon",
        message: "A Gathering is ending soon.",
        count: 1,
        href: `/desk/gatherings/${item.id}`,
        availability: "ok",
      });
    }
    for (const item of g.upcoming) {
      signals.push({
        id: `gathering_upcoming_${item.id}`,
        category: "soon",
        message: "A Gathering is upcoming.",
        count: 1,
        href: "/desk/gatherings",
        availability: "ok",
      });
    }
  }

  const hollow = await settle(() => loadHollowSlice(db));
  if (!hollow.ok) {
    allSourcesOk = false;
    signals.push({
      id: "hollow",
      category: "needs_attention",
      message: "Hollow rewards could not be checked.",
      count: null,
      href: null,
      availability: "unavailable",
    });
  } else {
    const h = hollow.value;
    if (h.partialOrFailedCampaigns > 0) {
      signals.push({
        id: "hollow_partial",
        category: "needs_attention",
        message: `${h.partialOrFailedCampaigns} Hollow ${plural(h.partialOrFailedCampaigns, "campaign finished partially", "campaigns finished partially")}.`,
        count: h.partialOrFailedCampaigns,
        href: "/desk/hollow?filter=requires_attention",
        availability: "ok",
      });
    }
    if (h.failedRewards > 0) {
      signals.push({
        id: "hollow_failed_rewards",
        category: "needs_attention",
        message: `${h.failedRewards} Hollow ${plural(h.failedRewards, "reward is", "rewards are")} failed.`,
        count: h.failedRewards,
        href: "/desk/hollow?filter=requires_attention",
        availability: "ok",
      });
    }
    if (h.draftOrResolved > 0) {
      signals.push({
        id: "hollow_unresolved",
        category: "needs_attention",
        message: `${h.draftOrResolved} Hollow ${plural(h.draftOrResolved, "campaign is", "campaigns are")} unresolved.`,
        count: h.draftOrResolved,
        href: "/desk/hollow",
        availability: "ok",
      });
    }
    if (h.unclaimedLeaf > 0) {
      signals.push({
        id: "hollow_unclaimed_leaf",
        category: "needs_attention",
        message: `${h.unclaimedLeaf} available Hollow LEAF ${plural(h.unclaimedLeaf, "reward remains", "rewards remain")} unclaimed.`,
        count: h.unclaimedLeaf,
        href: "/desk/hollow",
        availability: "ok",
      });
    }
  }

  const fire = await settle(() => countActiveFire(db, nowMs));
  if (!fire.ok) {
    allSourcesOk = false;
    signals.push({
      id: "fire_presence",
      category: "happening_now",
      message: "Fire presence could not be checked.",
      count: null,
      href: null,
      availability: "unavailable",
    });
  } else if (fire.value > 0) {
    signals.push({
      id: "fire_presence",
      category: "happening_now",
      message: `${fire.value} ${plural(fire.value, "member is", "members are")} at The Fire.`,
      count: fire.value,
      href: "/desk/fire",
      availability: "ok",
    });
  }

  const book = await settle(() => loadBookSlice());
  if (!book.ok) {
    allSourcesOk = false;
    signals.push({
      id: "book_missing",
      category: "needs_attention",
      message: "Living Book coverage could not be checked.",
      count: null,
      href: "/desk/book",
      availability: "unavailable",
    });
  } else {
    if (book.value.yesterdayMissing) {
      signals.push({
        id: "book_missing",
        category: "needs_attention",
        message: "Yesterday’s Living Book entry is missing.",
        count: 1,
        href: "/desk/book",
        availability: "ok",
      });
    } else if (book.value.recentGapCount > 0) {
      signals.push({
        id: "book_gap",
        category: "needs_attention",
        message: `${book.value.recentGapCount} recent Living Book ${plural(book.value.recentGapCount, "day is", "days are")} missing.`,
        count: book.value.recentGapCount,
        href: "/desk/book",
        availability: "ok",
      });
    }
  }

  const treasury = await settle(() => loadTreasurySlice());
  if (!treasury.ok) {
    allSourcesOk = false;
    signals.push({
      id: "treasury",
      category: "needs_attention",
      message: "Treasury could not be checked.",
      count: null,
      href: "/desk/treasury",
      availability: "unavailable",
    });
  } else if (treasury.value.state !== "ready") {
    const message =
      treasury.value.state === "unconfigured"
        ? "Treasury wallet is not configured."
        : treasury.value.state === "partial"
          ? "Treasury read is partial."
          : "Treasury read is unavailable.";
    signals.push({
      id: "treasury",
      category: "needs_attention",
      message,
      count: 1,
      href: "/desk/treasury",
      availability: "ok",
    });
  }

  const agent = await settle(() => loadAgentSlice(db));
  if (!agent.ok) {
    allSourcesOk = false;
    signals.push({
      id: "x_oauth",
      category: "needs_attention",
      message: "X Agent status could not be checked.",
      count: null,
      href: "/desk/agent",
      availability: "unavailable",
    });
  } else {
    const a = agent.value;
    if (a.oauthUnbound) {
      signals.push({
        id: "x_oauth",
        category: "needs_attention",
        message: "X OAuth is not bound.",
        count: 1,
        href: "/desk/agent",
        availability: "ok",
      });
    }
    if (a.failedEffects > 0) {
      signals.push({
        id: "agent_failed_effects",
        category: "needs_attention",
        message: `${a.failedEffects} X Agent ${plural(a.failedEffects, "effect failed", "effects failed")}.`,
        count: a.failedEffects,
        href: "/desk/agent",
        availability: "ok",
      });
    }
    if (a.stuckProcessing > 0) {
      signals.push({
        id: "agent_stuck",
        category: "needs_attention",
        message: `${a.stuckProcessing} X Agent ${plural(a.stuckProcessing, "row appears", "rows appear")} stuck processing.`,
        count: a.stuckProcessing,
        href: "/desk/agent",
        availability: "ok",
      });
    }
    if (a.pendingBacklog > 25) {
      signals.push({
        id: "agent_backlog",
        category: "needs_attention",
        message: `X Agent backlog is ${a.pendingBacklog}.`,
        count: a.pendingBacklog,
        href: "/desk/agent",
        availability: "ok",
      });
    }
    if (a.noRecentPoll) {
      signals.push({
        id: "agent_poll_stale",
        category: "soon",
        message:
          "No recent X poll update is recorded (inference — runtime may still be active).",
        count: 1,
        href: "/desk/agent",
        availability: "ok",
      });
    }
  }

  const categoryOrder: DeskAttentionSignal["category"][] = [
    "needs_attention",
    "happening_now",
    "soon",
  ];
  signals.sort((a, b) => {
    const ai = categoryOrder.indexOf(a.category);
    const bi = categoryOrder.indexOf(b.category);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  if (signals.length === 0 && allSourcesOk) {
    signals.push({
      id: "quiet",
      category: "quiet",
      message: "Nothing requires attention right now.",
      count: 0,
      href: null,
      availability: "ok",
    });
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    signals,
    allSourcesOk,
  };
}
