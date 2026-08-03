import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  escapeIlikePattern,
  type DeskRegisterQuery,
} from "@/lib/desk/register-query";
import type {
  DeskPresenceState,
  DeskRegisterListPage,
  DeskRegisterMemberDetail,
  DeskRegisterMemberListItem,
} from "@/lib/desk/register-types";
import {
  robinhoodAddressExplorerUrl,
  shortenWallet,
} from "@/lib/greenwood/hollow/explorer";
import { isFirePresenceActive } from "@/lib/greenwood/presence/filter";
import { DESK_CURRENT_SIGIL_SLUG_SELECT } from "@/lib/greenwood/sigil/embeds";
import { getDeskInviteSummary } from "@/lib/invites/member-summary";
import { getLeafHistory } from "@/lib/leaf/reads";
import { getStandingSnapshot } from "@/lib/leaf/standing";
import { assertProfileId } from "@/lib/leaf/validate";
import { formatOutlawNumber } from "@/lib/profiles/types";
import {
  isNormalizedEvmAddress,
  normalizeEvmAddress,
} from "@/lib/wallet/evm";

const PROFILE_LIST_SELECT =
  "id, outlaw_number, alias, wallet_address, joined_at, leaf_balance, leaf_lifetime_earned, greenwood_entered_at";

const DETAIL_ACTIVITY_LIMIT = 8;

/** Presence older than active timeout but within this window is "recently warm". */
const RECENTLY_WARM_MS = 15 * 60 * 1000;

type ProfileListRow = {
  id: string;
  outlaw_number: number;
  alias: string | null;
  wallet_address: string;
  joined_at: string;
  leaf_balance: number;
  leaf_lifetime_earned: number;
  greenwood_entered_at: string | null;
};

type PresenceRow = {
  profile_id: string;
  last_seen_at: string;
  sitting: boolean;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function displayName(alias: string | null, outlawNumber: number): string {
  const trimmed = alias?.trim();
  if (trimmed) return trimmed;
  return `Outlaw ${formatOutlawNumber(outlawNumber)}`;
}

function standingLabel(
  lifetime: number,
  threshold: number | null,
  meets: boolean | null,
): string {
  if (threshold == null || meets == null) {
    return `${lifetime} lifetime`;
  }
  return meets
    ? `${lifetime} · threshold met`
    : `${lifetime} · below ${threshold}`;
}

function resolvePresenceState(
  row: PresenceRow | undefined,
  nowMs: number,
): DeskPresenceState {
  if (!row) return "not_present";
  const seenMs = Date.parse(row.last_seen_at);
  if (!Number.isFinite(seenMs)) return "not_present";
  if (isFirePresenceActive(row.last_seen_at, nowMs)) {
    return row.sitting ? "sitting" : "at_the_fire";
  }
  if (nowMs - seenMs <= RECENTLY_WARM_MS) return "recently_warm";
  return "not_present";
}

async function readGreenwoodThreshold(
  db: SupabaseClient,
): Promise<number | null> {
  const { data, error } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "greenwood.lifetime_leaf_threshold")
    .maybeSingle();
  if (error || !data) return null;
  const raw = data.value;
  const candidate =
    typeof raw === "number"
      ? raw
      : raw &&
          typeof raw === "object" &&
          !Array.isArray(raw) &&
          "threshold" in raw
        ? (raw as { threshold: unknown }).threshold
        : null;
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
}

async function loadPresenceMap(
  db: SupabaseClient,
): Promise<Map<string, PresenceRow>> {
  const { data, error } = await db
    .from("greenwood_presence")
    .select(
      "profile_id, last_seen_at, sitting, profiles!inner(greenwood_entered_at)",
    )
    .not("profiles.greenwood_entered_at", "is", null);
  if (error) throw new Error(error.message);
  const map = new Map<string, PresenceRow>();
  for (const row of data ?? []) {
    const r = row as PresenceRow;
    map.set(r.profile_id, r);
  }
  return map;
}

function activeFireIds(
  presenceMap: Map<string, PresenceRow>,
  nowMs: number,
): Set<string> {
  const ids = new Set<string>();
  for (const [id, row] of presenceMap) {
    if (isFirePresenceActive(row.last_seen_at, nowMs)) ids.add(id);
  }
  return ids;
}

async function loadPendingDeedCounts(
  db: SupabaseClient,
  profileIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (profileIds.length === 0) return counts;
  const { data, error } = await db
    .from("deed_submissions")
    .select("profile_id")
    .eq("status", "pending")
    .in("profile_id", profileIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const id = String((row as { profile_id: string }).profile_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function loadPendingProfileIds(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db
    .from("deed_submissions")
    .select("profile_id")
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return [
    ...new Set(
      (data ?? []).map((r) => String((r as { profile_id: string }).profile_id)),
    ),
  ];
}

async function loadXHandles(
  db: SupabaseClient,
  profileIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (profileIds.length === 0) return map;
  const { data, error } = await db
    .from("outlaw_applications")
    .select("profile_id, x_handle")
    .in("profile_id", profileIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const r = row as { profile_id: string; x_handle: string | null };
    map.set(r.profile_id, r.x_handle?.trim() || null);
  }
  return map;
}

async function loadSigils(
  db: SupabaseClient,
  profileIds: string[],
): Promise<
  Map<string, { asciiBody: string; a11yLabel: string; slug: string }>
> {
  const map = new Map<
    string,
    { asciiBody: string; a11yLabel: string; slug: string }
  >();
  if (profileIds.length === 0) return map;
  const { data, error } = await db
    .from("greenwood_sigil_assignments")
    .select(DESK_CURRENT_SIGIL_SLUG_SELECT)
    .in("profile_id", profileIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const r = row as unknown as {
      profile_id: string;
      greenwood_sigil_catalogue:
        | {
            slug: string;
            ascii_body: string;
            a11y_label: string;
          }
        | {
            slug: string;
            ascii_body: string;
            a11y_label: string;
          }[]
        | null;
    };
    const cat = Array.isArray(r.greenwood_sigil_catalogue)
      ? r.greenwood_sigil_catalogue[0]
      : r.greenwood_sigil_catalogue;
    if (!cat) continue;
    map.set(r.profile_id, {
      slug: cat.slug,
      asciiBody: cat.ascii_body,
      a11yLabel: cat.a11y_label,
    });
  }
  return map;
}

function classifySearch(q: string): {
  kind: "wallet" | "number" | "text";
  value: string;
} {
  const trimmed = q.trim();
  if (/^0x[a-fA-F0-9]*$/i.test(trimmed) && trimmed.length >= 3) {
    return { kind: "wallet", value: normalizeEvmAddress(trimmed) };
  }
  if (/^\d{1,10}$/.test(trimmed)) {
    return { kind: "number", value: String(Number(trimmed)) };
  }
  return { kind: "text", value: trimmed };
}

function intersectIds(
  a: string[] | null,
  b: string[] | null,
): string[] | null {
  if (a == null) return b;
  if (b == null) return a;
  const setB = new Set(b);
  return a.filter((id) => setB.has(id));
}

function emptyPage(query: DeskRegisterQuery): DeskRegisterListPage {
  return {
    members: [],
    page: query.page,
    limit: query.limit,
    total: 0,
    hasMore: false,
  };
}

/**
 * Paginated Desk Register list. Authoritative wallet = profiles.wallet_address.
 */
export async function listDeskRegisterMembers(
  query: DeskRegisterQuery,
  nowMs: number = Date.now(),
): Promise<DeskRegisterListPage> {
  const db = await defaultAdmin();
  const presenceMap = await loadPresenceMap(db);
  const threshold = await readGreenwoodThreshold(db);
  const atFire = activeFireIds(presenceMap, nowMs);

  let includeIds: string[] | null = null;

  if (query.presence === "at_fire") {
    includeIds = [...atFire];
    if (includeIds.length === 0) return emptyPage(query);
  }

  if (query.pendingDeeds === "pending") {
    const pendingIds = await loadPendingProfileIds(db);
    includeIds = intersectIds(includeIds, pendingIds);
    if (!includeIds || includeIds.length === 0) return emptyPage(query);
  }

  let xHandleProfileIds: string[] = [];
  if (query.q) {
    const classified = classifySearch(query.q);
    if (classified.kind === "text") {
      const pattern = `%${escapeIlikePattern(classified.value)}%`;
      const { data: appRows, error: appError } = await db
        .from("outlaw_applications")
        .select("profile_id")
        .ilike("x_handle", pattern);
      if (appError) throw new Error(appError.message);
      xHandleProfileIds = (appRows ?? []).map((r) =>
        String((r as { profile_id: string }).profile_id),
      );
    }
  }

  let builder = db
    .from("profiles")
    .select(PROFILE_LIST_SELECT, { count: "exact" });

  if (query.greenwood === "member") {
    builder = builder.not("greenwood_entered_at", "is", null);
  } else if (query.greenwood === "non_member") {
    builder = builder.is("greenwood_entered_at", null);
  }

  if (includeIds) {
    builder = builder.in("id", includeIds);
  }

  if (query.presence === "not_present" && atFire.size > 0) {
    builder = builder.not("id", "in", `(${[...atFire].join(",")})`);
  }

  if (query.q) {
    const classified = classifySearch(query.q);
    if (classified.kind === "wallet") {
      builder = builder.ilike(
        "wallet_address",
        `${escapeIlikePattern(classified.value)}%`,
      );
    } else if (classified.kind === "number") {
      builder = builder.eq("outlaw_number", Number(classified.value));
    } else {
      const pattern = `%${escapeIlikePattern(classified.value)}%`;
      if (xHandleProfileIds.length > 0) {
        builder = builder.or(
          `alias.ilike.${pattern},id.in.(${xHandleProfileIds.join(",")})`,
        );
      } else {
        builder = builder.ilike("alias", pattern);
      }
    }
  }

  const from = (query.page - 1) * query.limit;
  const to = from + query.limit - 1;
  const { data, error, count } = await builder
    .order("outlaw_number", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ProfileListRow[];
  const ids = rows.map((r) => r.id);
  const [xHandles, sigils, pendingCounts] = await Promise.all([
    loadXHandles(db, ids),
    loadSigils(db, ids),
    loadPendingDeedCounts(db, ids),
  ]);

  const members: DeskRegisterMemberListItem[] = rows.map((row) => {
    const lifetime = Number(row.leaf_lifetime_earned) || 0;
    const meets = threshold == null ? null : lifetime >= threshold;
    const wallet = normalizeEvmAddress(row.wallet_address);
    const sigil = sigils.get(row.id) ?? null;
    return {
      profileId: row.id,
      outlawNumber: Number(row.outlaw_number),
      outlawNumberLabel: formatOutlawNumber(Number(row.outlaw_number)),
      displayName: displayName(row.alias, Number(row.outlaw_number)),
      walletAddress: wallet,
      walletShort: shortenWallet(wallet) ?? wallet,
      xHandle: xHandles.get(row.id) ?? null,
      joinedAt: row.joined_at,
      leafBalance: Number(row.leaf_balance) || 0,
      leafLifetimeEarned: lifetime,
      standingLabel: standingLabel(lifetime, threshold, meets),
      greenwoodMember: row.greenwood_entered_at != null,
      greenwoodEnteredAt: row.greenwood_entered_at,
      sigil: sigil
        ? { asciiBody: sigil.asciiBody, a11yLabel: sigil.a11yLabel }
        : null,
      presence: resolvePresenceState(presenceMap.get(row.id), nowMs),
      pendingDeedCount: pendingCounts.get(row.id) ?? 0,
      explorerUrl: isNormalizedEvmAddress(wallet)
        ? robinhoodAddressExplorerUrl(wallet)
        : null,
    };
  });

  const total = count ?? members.length;
  return {
    members,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: from + members.length < total,
  };
}

export async function getDeskRegisterMember(
  profileIdRaw: string,
  nowMs: number = Date.now(),
): Promise<DeskRegisterMemberDetail | null> {
  let profileId: string;
  try {
    profileId = assertProfileId(profileIdRaw);
  } catch {
    return null;
  }

  const db = await defaultAdmin();
  const { data, error } = await db
    .from("profiles")
    .select(PROFILE_LIST_SELECT)
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as ProfileListRow;
  const [
    xHandles,
    sigils,
    presenceMap,
    standing,
    ledger,
    deeds,
    hands,
    hollow,
    camp,
    firstThirtyRes,
    inviteSummary,
  ] = await Promise.all([
    loadXHandles(db, [profileId]),
    loadSigils(db, [profileId]),
    loadPresenceMap(db),
    getStandingSnapshot(profileId).catch(() => null),
    getLeafHistory(profileId, { limit: DETAIL_ACTIVITY_LIMIT }).catch(() => ({
      entries: [],
      nextCursor: null,
    })),
    db
      .from("deed_submissions")
      .select("id, status, submitted_at, leaf_awarded, deeds ( title )")
      .eq("profile_id", profileId)
      .order("submitted_at", { ascending: false })
      .limit(DETAIL_ACTIVITY_LIMIT),
    db
      .from("greenwood_gathering_hands")
      .select(
        "gathering_id, raised_at, lowered_at, greenwood_gatherings ( title )",
      )
      .eq("profile_id", profileId)
      .order("raised_at", { ascending: false })
      .limit(DETAIL_ACTIVITY_LIMIT),
    db
      .from("greenwood_hollow_rewards")
      .select("id, title, reward_type, amount, status, transaction_hash")
      .eq("profile_id", profileId)
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(DETAIL_ACTIVITY_LIMIT),
    db
      .from("camp_sessions")
      .select("id, last_message_at, message_count")
      .eq("profile_id", profileId),
    db
      .from("first_thirty_progress")
      .select(
        "status, eligible_camp_exchange_count, first_camp_satisfied_at, third_camp_satisfied_at, first_deed_satisfied_at, onboarding_leaf_granted",
      )
      .eq("profile_id", profileId)
      .maybeSingle(),
    getDeskInviteSummary({ profileId, admin: db }).catch(() => ({
      registeredInviteCount: 0,
      rewardedInviteCount: 0,
      inviteLeafGranted: 0,
      rewardedInvitesRemaining: 10,
      recentArrivals: [],
    })),
  ]);

  if (deeds.error) throw new Error(deeds.error.message);
  if (hands.error) throw new Error(hands.error.message);
  if (hollow.error) throw new Error(hollow.error.message);
  if (camp.error) throw new Error(camp.error.message);
  // firstThirty may fail if migration not applied — treat as null
  const firstThirtyRow = firstThirtyRes.error
    ? null
    : (firstThirtyRes.data as {
        status: string;
        eligible_camp_exchange_count: number;
        first_camp_satisfied_at: string | null;
        third_camp_satisfied_at: string | null;
        first_deed_satisfied_at: string | null;
        onboarding_leaf_granted: number;
      } | null);

  const wallet = normalizeEvmAddress(row.wallet_address);
  const sigil = sigils.get(profileId) ?? null;
  const lifetime = Number(row.leaf_lifetime_earned) || 0;
  const threshold = standing?.greenwoodThreshold ?? null;
  const meets = standing?.meetsGreenwoodThreshold ?? null;

  const campRows = (camp.data ?? []) as Array<{
    id: string;
    last_message_at: string | null;
    message_count: number;
  }>;
  let lastMessageAt: string | null = null;
  let totalMessages = 0;
  for (const s of campRows) {
    totalMessages += Number(s.message_count) || 0;
    if (
      s.last_message_at &&
      (!lastMessageAt || s.last_message_at > lastMessageAt)
    ) {
      lastMessageAt = s.last_message_at;
    }
  }

  return {
    profileId: row.id,
    outlawNumber: Number(row.outlaw_number),
    outlawNumberLabel: formatOutlawNumber(Number(row.outlaw_number)),
    displayName: displayName(row.alias, Number(row.outlaw_number)),
    walletAddress: wallet,
    walletShort: shortenWallet(wallet) ?? wallet,
    explorerUrl: isNormalizedEvmAddress(wallet)
      ? robinhoodAddressExplorerUrl(wallet)
      : null,
    xHandle: xHandles.get(profileId) ?? null,
    joinedAt: row.joined_at,
    leafBalance: Number(row.leaf_balance) || 0,
    leafLifetimeEarned: lifetime,
    standingLabel: standingLabel(lifetime, threshold, meets),
    greenwoodThreshold: threshold,
    meetsGreenwoodThreshold: meets,
    greenwoodMember: row.greenwood_entered_at != null,
    greenwoodEnteredAt: row.greenwood_entered_at,
    sigil: sigil
      ? {
          asciiBody: sigil.asciiBody,
          a11yLabel: sigil.a11yLabel,
          slug: sigil.slug,
        }
      : null,
    presence: resolvePresenceState(presenceMap.get(profileId), nowMs),
    recentDeeds: (deeds.data ?? []).map((d) => {
      const r = d as {
        id: string;
        status: string;
        submitted_at: string;
        leaf_awarded: number | null;
        deeds: { title: string } | { title: string }[] | null;
      };
      const deed = Array.isArray(r.deeds) ? r.deeds[0] : r.deeds;
      return {
        submissionId: r.id,
        deedTitle: deed?.title ?? "Deed",
        status: r.status,
        submittedAt: r.submitted_at,
        leafAwarded: r.leaf_awarded,
      };
    }),
    recentGatheringHands: (hands.data ?? []).map((h) => {
      const r = h as {
        gathering_id: string;
        raised_at: string;
        lowered_at: string | null;
        greenwood_gatherings: { title: string } | { title: string }[] | null;
      };
      const g = Array.isArray(r.greenwood_gatherings)
        ? r.greenwood_gatherings[0]
        : r.greenwood_gatherings;
      return {
        gatheringId: r.gathering_id,
        title: g?.title ?? "Gathering",
        raisedAt: r.raised_at,
        loweredAt: r.lowered_at,
        handOpen: r.lowered_at == null,
      };
    }),
    recentHollow: (hollow.data ?? []).map((h) => {
      const r = h as {
        id: string;
        title: string;
        reward_type: string;
        amount: number | string | null;
        status: string;
        transaction_hash: string | null;
      };
      return {
        rewardId: r.id,
        title: r.title,
        rewardType: r.reward_type,
        amount: r.amount == null ? null : Number(r.amount),
        status: r.status,
        transactionHash: r.transaction_hash,
      };
    }),
    recentLedger: ledger.entries.map((e) => ({
      id: e.id,
      amount: e.amount,
      sourceType: e.sourceType,
      reason: e.reason,
      createdAt: e.createdAt,
    })),
    camp: {
      sessionCount: campRows.length,
      lastMessageAt,
      totalMessages,
    },
    firstThirty: buildDeskFirstThirty({
      row: firstThirtyRow,
      lifetime,
      threshold,
      greenwoodMember: row.greenwood_entered_at != null,
    }),
    invite: inviteSummary,
  };
}

function buildDeskFirstThirty(input: {
  row: {
    status: string;
    eligible_camp_exchange_count: number;
    first_camp_satisfied_at: string | null;
    third_camp_satisfied_at: string | null;
    first_deed_satisfied_at: string | null;
    onboarding_leaf_granted: number;
  } | null;
  lifetime: number;
  threshold: number | null;
  greenwoodMember: boolean;
}): import("@/lib/desk/register-types").DeskRegisterFirstThirty {
  const thresh = input.threshold ?? 30;
  const greenwoodOpen =
    input.greenwoodMember || input.lifetime >= thresh;
  if (!input.row) {
    return {
      status: greenwoodOpen ? "n_a" : "unstarted",
      eligibleCampExchanges: 0,
      milestones: {
        firstCamp: false,
        thirdCamp: false,
        firstDeed: false,
      },
      onboardingLeafGranted: 0,
      lifetimeLeaf: input.lifetime,
      leafUntilGreenwood: Math.max(0, thresh - input.lifetime),
      greenwoodOpen,
    };
  }
  const status =
    input.row.status === "active" ||
    input.row.status === "completed" ||
    input.row.status === "terminated"
      ? input.row.status
      : "unstarted";
  return {
    status: greenwoodOpen && status === "active" ? "terminated" : status,
    eligibleCampExchanges: Number(input.row.eligible_camp_exchange_count) || 0,
    milestones: {
      firstCamp: input.row.first_camp_satisfied_at != null,
      thirdCamp: input.row.third_camp_satisfied_at != null,
      firstDeed: input.row.first_deed_satisfied_at != null,
    },
    onboardingLeafGranted: Number(input.row.onboarding_leaf_granted) || 0,
    lifetimeLeaf: input.lifetime,
    leafUntilGreenwood: Math.max(0, thresh - input.lifetime),
    greenwoodOpen,
  };
}
