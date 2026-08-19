import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readConfirmedOutlawCount,
  readGreenwoodLeafThreshold,
  readGreenwoodMemberCount,
  readOfficialFennToken,
} from "@/lib/agent/public-fact-readers";
import { formatUtcDate, isUtcDateString, utcDayBounds } from "@/lib/chronicle/dates";
import { findDailyChronicleByCoveredDate, listPublicChronicleEntries } from "@/lib/chronicle/read";
import { buildDailyWorldSnapshot } from "@/lib/chronicle/snapshot";
import { getPublicCommonsSnapshot } from "@/lib/commons/snapshot";
import { listPublicDeeds } from "@/lib/deeds/queries";
import { getDeskFireSnapshot } from "@/lib/desk/fire";
import { EditorialError } from "@/lib/editorial/errors";
import { buildEditorialRobinhoodContext } from "@/lib/editorial/robinhood-context";
import type {
  EditorialContextPack,
  EditorialNewsroomItem,
  EditorialProtectedFacts,
  EditorialRecentWritingSnippet,
  EditorialWorldState,
  EditorialWorldContext,
} from "@/lib/editorial/types";
import { EDITORIAL_CONTEXT_CAPS } from "@/lib/editorial/types";
import { getCurrentPublishedFireMessage } from "@/lib/greenwood/fire-messages/ops";
import { getPublicHomeGatheringCall } from "@/lib/greenwood/gatherings/public-home-signal";
import { listPublicLeafRecognitions } from "@/lib/ledger/page-data";
import { getPublicOfficialFennToken } from "@/lib/treasury/official-token";
import { getPublicTreasurySnapshot } from "@/lib/treasury/snapshot";
import { listPublicWallEntries } from "@/lib/wall/read";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

async function settleOrNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

function trunc(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function hoursAgo(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (nowMs - t) / (1000 * 60 * 60);
}

function priorityFromAge(hours: number | null, isActiveState = false): 1 | 2 | 3 | 4 {
  if (isActiveState) return hours != null && hours <= 24 ? 1 : 4;
  if (hours == null) return 4;
  if (hours <= 24) return 1;
  if (hours <= 72) return 2;
  return 3;
}

function pickDiverse(
  items: EditorialNewsroomItem[],
  limit: number,
): EditorialNewsroomItem[] {
  const sorted = [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const at = a.occurredAt ? Date.parse(a.occurredAt) : 0;
    const bt = b.occurredAt ? Date.parse(b.occurredAt) : 0;
    return bt - at;
  });
  const out: EditorialNewsroomItem[] = [];
  const typeCount = new Map<string, number>();
  for (const item of sorted) {
    if (out.length >= limit) break;
    const n = typeCount.get(item.type) ?? 0;
    if (n >= 2 && sorted.length > limit) continue;
    typeCount.set(item.type, n + 1);
    out.push(item);
  }
  // Fill remaining if diversity filter left slots empty.
  if (out.length < limit) {
    for (const item of sorted) {
      if (out.length >= limit) break;
      if (!out.includes(item)) out.push(item);
    }
  }
  return out;
}

async function loadRecentEditorialSnippets(
  admin: SupabaseClient,
  limit: number,
): Promise<EditorialRecentWritingSnippet[]> {
  const { data, error } = await admin
    .from("editorial_transmissions")
    .select("body, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Array<{ body: string; created_at: string }>).map((row) => ({
    source: "editorial" as const,
    text: trunc(row.body, EDITORIAL_CONTEXT_CAPS.snippetChars),
    createdAt: row.created_at,
  }));
}

function buildWorldState(input: {
  outlawCount: number | null;
  greenwoodMembers: number | null;
  threshold: number | null;
  campMessages: number;
  wallCount: number | null;
  deedsCount: number;
  bookWritten: boolean;
  speaksPresent: boolean;
  gatheringActive: boolean;
  treasuryState: string;
  commonsState: string;
  tokenConfigured: boolean;
  xRepliesToday: number;
}): EditorialWorldState {
  const liveSurfaces = [
    "Register",
    "Greenwood",
    "Camp",
    "Clearing",
    "Wall",
    "Deeds",
    "Book",
    "Oak",
    "Commons",
    "Ledger",
    "VELL SPEAKS",
    "Gatherings",
    "X agent",
    "Treasury",
  ];
  if (input.tokenConfigured) {
    liveSurfaces.push("Official $VELL");
  }

  return {
    liveSurfaces,
    registerNote:
      input.outlawCount != null
        ? `Register holds ${input.outlawCount} confirmed Outlaws (trusted public aggregate).`
        : null,
    greenwoodNote:
      input.greenwoodMembers != null
        ? `Greenwood has ${input.greenwoodMembers} admitted members${
            input.threshold != null
              ? `; lifetime LEAF threshold is ${input.threshold}`
              : ""
          }.`
        : input.threshold != null
          ? `Greenwood lifetime LEAF threshold is ${input.threshold}.`
          : null,
    campNote:
      input.campMessages > 0
        ? `Camp recorded ${input.campMessages} messages today (count only; no transcripts).`
        : "Camp is live; today shows no message count in the day snapshot.",
    clearingNote: "Clearing is a live VELL surface (no private message content attached).",
    wallNote:
      input.wallCount != null
        ? `Wall has recent public inscriptions available for sampling.`
        : "Wall is live.",
    deedsNote:
      input.deedsCount > 0
        ? `${input.deedsCount} public Deeds visible on the board.`
        : "Deeds board is live; no public Deeds currently listed.",
    chronicleNote: input.bookWritten
      ? "The Book has a daily entry for the covered date."
      : "Chronicle / Living Book is live; no daily entry recorded for the covered date yet.",
    commonsNote: `Commons public state: ${input.commonsState}.`,
    ledgerNote: "Ledger publicly records LEAF recognition (contribution, not price).",
    speaksNote: input.speaksPresent
      ? "A published VELL SPEAKS message is currently live."
      : "VELL SPEAKS can be published; none currently published (or unreadable).",
    gatheringNote: input.gatheringActive
      ? "A Gathering is active in the world."
      : "No active public world-call Gathering right now.",
    xAgentNote:
      input.xRepliesToday > 0
        ? `X agent recorded ${input.xRepliesToday} replies today (count only).`
        : "X agent is a live surface; no replies counted in today's snapshot.",
    tokenNote: input.tokenConfigured
      ? "Official $VELL public contract is configured."
      : "No official public $VELL contract configured for citation.",
    treasuryNote: `Treasury public state: ${input.treasuryState}.`,
  };
}

/**
 * Assemble the Editorial newsroom context pack.
 * Bounded, fail-closed optional readers. Counts + public labels + short samples only.
 */
export async function buildEditorialContextPack(options?: {
  coveredDate?: string;
  whatMattersToday?: string | null;
  /** Untrusted Keeper speak-once context — never promoted to protectedFacts. */
  keeperSituationalContext?: string | null;
  admin?: SupabaseClient;
  nowMs?: number;
}): Promise<EditorialContextPack> {
  const nowMs = options?.nowMs ?? Date.now();
  const now = new Date(nowMs);
  const coveredDate =
    options?.coveredDate ??
    formatUtcDate(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    );

  if (!isUtcDateString(coveredDate)) {
    throw new EditorialError(
      "editorial_invalid_input",
      "Invalid covered date",
      400,
    );
  }
  utcDayBounds(coveredDate);

  const admin = options?.admin ?? (await defaultAdmin());
  const whatMattersToday = options?.whatMattersToday?.trim() || null;
  const keeperSituationalContext =
    options?.keeperSituationalContext?.trim() || null;

  const [
    snapshot,
    book,
    fire,
    treasury,
    commons,
    wallEntries,
    deeds,
    chronicles,
    speaks,
    gatheringCall,
    leafRecs,
    outlawFact,
    greenwoodCountFact,
    thresholdFact,
    tokenFact,
    officialToken,
    editorialSnippets,
  ] = await Promise.all([
    buildDailyWorldSnapshot(coveredDate, { admin }),
    settleOrNull(findDailyChronicleByCoveredDate(coveredDate)),
    settleOrNull(getDeskFireSnapshot(nowMs)),
    settleOrNull(getPublicTreasurySnapshot()),
    settleOrNull(getPublicCommonsSnapshot()),
    settleOrNull(
      listPublicWallEntries({
        limit: EDITORIAL_CONTEXT_CAPS.wallSamples,
        admin,
      }),
    ),
    settleOrNull(listPublicDeeds(now)),
    settleOrNull(
      listPublicChronicleEntries({
        limit: EDITORIAL_CONTEXT_CAPS.chronicle,
        admin,
      }),
    ),
    settleOrNull(getCurrentPublishedFireMessage(admin)),
    settleOrNull(getPublicHomeGatheringCall(admin, nowMs)),
    settleOrNull(
      listPublicLeafRecognitions({ limit: EDITORIAL_CONTEXT_CAPS.xReplies }),
    ),
    readConfirmedOutlawCount({ admin }),
    readGreenwoodMemberCount({ admin }),
    readGreenwoodLeafThreshold(),
    readOfficialFennToken(),
    settleOrNull(getPublicOfficialFennToken()),
    settleOrNull(
      loadRecentEditorialSnippets(
        admin,
        EDITORIAL_CONTEXT_CAPS.recentEditorialWriting,
      ),
    ),
  ]);

  const bookPreview = book
    ? trunc(book.body, EDITORIAL_CONTEXT_CAPS.detailChars)
    : null;

  const signalKeys = [
    "bookWritten",
    "bookTitle",
    "fireWaitingCount",
    "gatheringState",
    "newOutlaws",
    "deedSubmissionsApproved",
    "deedsCreated",
    "greenwoodAdmissions",
    "wallInscriptions",
    "campMessages",
    "campLeafRecognised",
    "leafRecognisedTotal",
    "leafRecognitionEvents",
    "fennXReplies",
    "fennWallWrites",
    "commonsAllocationEvents",
    "commonsState",
    "treasuryState",
    "quiet",
    "officialToken",
    "greenwoodLeafThreshold",
    "outlawCount",
    "greenwoodMemberCount",
    "newsroom",
    "whatMattersToday",
  ];

  const world: EditorialWorldContext = {
    coveredDate,
    book: {
      written: Boolean(book),
      title: book?.title ?? null,
      preview: bookPreview,
    },
    fireWaitingCount: fire?.sittingCount ?? 0,
    gathering: {
      activeTitle: fire?.activeGathering?.title ?? null,
      stateLabel: fire?.activeGathering ? "open" : "none",
    },
    newOutlaws: snapshot.newOutlaws,
    deedSubmissionsApproved: snapshot.deedSubmissionsApproved,
    deedsCreated: snapshot.deedsCreated,
    greenwoodAdmissions: snapshot.greenwoodAdmissions,
    wallInscriptions: snapshot.wallInscriptions,
    campMessages: snapshot.campMessages,
    campLeafRecognised: snapshot.campLeafRecognised,
    leafRecognisedTotal: snapshot.leafRecognisedTotal,
    leafRecognitionEvents: snapshot.leafRecognitionEvents,
    fennXReplies: snapshot.fennXReplies,
    fennWallWrites: snapshot.fennWallWrites,
    commonsAllocationEvents: snapshot.commonsAllocationEvents,
    commonsState: commons?.state ?? "unavailable",
    treasuryState: treasury?.state ?? "unconfigured",
    quiet: snapshot.quiet,
    signalKeys,
    officialContractAddress: officialToken?.contractAddress ?? null,
  };

  const robinhood = buildEditorialRobinhoodContext(world);

  const newsroomCandidates: EditorialNewsroomItem[] = [];

  if (book) {
    newsroomCandidates.push({
      type: "chronicle",
      occurredAt: book.publishedAt ?? null,
      headline: book.title
        ? `The Book records today: ${trunc(book.title, 80)}`
        : "The Book has been written for this day.",
      detail: bookPreview,
      sourceId: book.id ?? null,
      priority: 1,
    });
  }

  for (const entry of wallEntries ?? []) {
    const hours = hoursAgo(entry.createdAt, nowMs);
    if (hours != null && hours > 72) continue;
    newsroomCandidates.push({
      type: "wall",
      occurredAt: entry.createdAt,
      headline: "A new mark on the Wall",
      detail: trunc(entry.body, EDITORIAL_CONTEXT_CAPS.detailChars),
      sourceId: entry.id,
      priority: priorityFromAge(hours),
    });
  }

  for (const deed of (deeds ?? []).slice(0, EDITORIAL_CONTEXT_CAPS.deeds)) {
    newsroomCandidates.push({
      type: "deed",
      occurredAt: deed.publishedAt ?? null,
      headline: `A Deed on the board: ${trunc(deed.title, 80)}`,
      detail: trunc(deed.loreDescription ?? deed.instructions ?? "", EDITORIAL_CONTEXT_CAPS.detailChars) || null,
      sourceId: deed.id,
      priority: priorityFromAge(hoursAgo(deed.publishedAt ?? null, nowMs), true),
    });
  }

  if (speaks?.body) {
    newsroomCandidates.push({
      type: "speaks",
      occurredAt: speaks.publishedAt,
      headline: "VELL SPEAKS is live",
      detail: trunc(speaks.body, EDITORIAL_CONTEXT_CAPS.detailChars),
      sourceId: null,
      priority: priorityFromAge(hoursAgo(speaks.publishedAt, nowMs), true),
    });
  }

  if (fire?.activeGathering?.title) {
    newsroomCandidates.push({
      type: "gathering",
      occurredAt: null,
      headline: `Gathering open: ${trunc(fire.activeGathering.title, 80)}`,
      detail: `${fire.sittingCount} at the Fire (count only).`,
      sourceId: null,
      priority: 1,
    });
  } else if (gatheringCall?.active) {
    newsroomCandidates.push({
      type: "gathering",
      occurredAt: gatheringCall.startsAt ?? null,
      headline: "A Gathering is active in the world",
      detail: gatheringCall.endsAt
        ? `Ends ${gatheringCall.endsAt}`
        : "Active world-call Gathering",
      sourceId: null,
      priority: 1,
    });
  }

  for (const rec of (leafRecs?.entries ?? []).slice(0, 3)) {
    const hours = hoursAgo(rec.createdAt, nowMs);
    if (hours != null && hours > 72) continue;
    newsroomCandidates.push({
      type: "leaf",
      occurredAt: rec.createdAt,
      headline: "LEAF recognition recorded on the Ledger",
      detail: trunc(
        [
          rec.outlawLabel ? `to ${rec.outlawLabel}` : null,
          rec.amount != null ? `${rec.amount} LEAF` : null,
          rec.summary ? trunc(rec.summary, 80) : null,
          rec.deedTitle ? `Deed: ${trunc(rec.deedTitle, 60)}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Public LEAF recognition",
        EDITORIAL_CONTEXT_CAPS.detailChars,
      ),
      sourceId: rec.id,
      priority: priorityFromAge(hours),
    });
  }

  if (snapshot.fennXReplies > 0) {
    newsroomCandidates.push({
      type: "x_agent",
      occurredAt: null,
      headline: `X agent replied ${snapshot.fennXReplies} time(s) today`,
      detail: "Count only — no reply bodies attached from this source.",
      sourceId: null,
      priority: 1,
    });
  }

  if (snapshot.fennWallWrites > 0) {
    newsroomCandidates.push({
      type: "wall",
      occurredAt: null,
      headline: `VELL wrote to the Wall ${snapshot.fennWallWrites} time(s) today`,
      detail: null,
      sourceId: null,
      priority: 1,
    });
  }

  if (snapshot.commonsAllocationEvents > 0) {
    newsroomCandidates.push({
      type: "commons",
      occurredAt: null,
      headline: `Commons allocation activity today (${snapshot.commonsAllocationEvents})`,
      detail: null,
      sourceId: null,
      priority: 1,
    });
  }

  if (snapshot.newOutlaws > 0) {
    newsroomCandidates.push({
      type: "register",
      occurredAt: null,
      headline: `${snapshot.newOutlaws} new name(s) on the Register today`,
      detail: null,
      sourceId: null,
      priority: 1,
    });
  }

  if (snapshot.greenwoodAdmissions > 0) {
    newsroomCandidates.push({
      type: "greenwood",
      occurredAt: null,
      headline: `${snapshot.greenwoodAdmissions} Greenwood admission(s) today`,
      detail: null,
      sourceId: null,
      priority: 1,
    });
  }

  if (snapshot.deedSubmissionsApproved > 0) {
    newsroomCandidates.push({
      type: "deed",
      occurredAt: null,
      headline: `${snapshot.deedSubmissionsApproved} Deed submission(s) approved today`,
      detail: null,
      sourceId: null,
      priority: 1,
    });
  }

  if (officialToken) {
    newsroomCandidates.push({
      type: "token",
      occurredAt: null,
      headline: `Official ${officialToken.symbol} public contract is configured`,
      detail: trunc(
        `${officialToken.contractAddress} · chain ${officialToken.chainId}`,
        EDITORIAL_CONTEXT_CAPS.detailChars,
      ),
      sourceId: null,
      priority: 4,
    });
  }

  if (world.treasuryState === "ready") {
    newsroomCandidates.push({
      type: "treasury",
      occurredAt: null,
      headline: "Public Treasury is readable",
      detail: null,
      sourceId: null,
      priority: 4,
    });
  }

  const headlines = pickDiverse(
    newsroomCandidates,
    EDITORIAL_CONTEXT_CAPS.newsroomHeadlines,
  );
  const notableUsed = new Set(headlines.map((h) => `${h.type}:${h.headline}`));
  const notableActivity = pickDiverse(
    newsroomCandidates.filter((i) => !notableUsed.has(`${i.type}:${i.headline}`)),
    EDITORIAL_CONTEXT_CAPS.notableActivity,
  );

  const thresholdValue =
    thresholdFact.available && typeof thresholdFact.value === "number"
      ? thresholdFact.value
      : null;
  const outlawCount =
    outlawFact.available && typeof outlawFact.value === "number"
      ? outlawFact.value
      : null;
  const greenwoodMemberCount =
    greenwoodCountFact.available && typeof greenwoodCountFact.value === "number"
      ? greenwoodCountFact.value
      : null;

  const protectedFacts: EditorialProtectedFacts = {
    coveredDate,
    officialToken: officialToken
      ? {
          symbol: officialToken.symbol,
          chainId: officialToken.chainId,
          contractAddress: officialToken.contractAddress,
          explorerUrl: officialToken.explorerUrl,
        }
      : null,
    greenwoodLeafThreshold: thresholdValue,
    outlawCount,
    greenwoodMemberCount,
    activeGathering: {
      active: Boolean(fire?.activeGathering) || Boolean(gatheringCall?.active),
      title: fire?.activeGathering?.title ?? null,
      stateLabel: fire?.activeGathering
        ? "open"
        : gatheringCall?.active
          ? "active"
          : "none",
    },
    treasuryState: world.treasuryState,
    commonsState: world.commonsState,
    dayCounts: {
      newOutlaws: world.newOutlaws,
      deedSubmissionsApproved: world.deedSubmissionsApproved,
      deedsCreated: world.deedsCreated,
      greenwoodAdmissions: world.greenwoodAdmissions,
      wallInscriptions: world.wallInscriptions,
      campMessages: world.campMessages,
      leafRecognitionEvents: world.leafRecognitionEvents,
      leafRecognisedTotal: world.leafRecognisedTotal,
      fennXReplies: world.fennXReplies,
      fennWallWrites: world.fennWallWrites,
      commonsAllocationEvents: world.commonsAllocationEvents,
      fireWaitingCount: world.fireWaitingCount,
    },
    bookWrittenToday: world.book.written,
    bookTitle: world.book.title,
    quietDay: world.quiet,
  };

  const worldState = buildWorldState({
    outlawCount,
    greenwoodMembers: greenwoodMemberCount,
    threshold: thresholdValue,
    campMessages: world.campMessages,
    wallCount: wallEntries?.length ?? null,
    deedsCount: (deeds ?? []).length,
    bookWritten: world.book.written,
    speaksPresent: Boolean(speaks?.body),
    gatheringActive: protectedFacts.activeGathering.active,
    treasuryState: world.treasuryState,
    commonsState: world.commonsState,
    tokenConfigured: Boolean(officialToken),
    xRepliesToday: world.fennXReplies,
  });

  const recentWriting: EditorialRecentWritingSnippet[] = [];
  if (editorialSnippets) {
    recentWriting.push(...editorialSnippets);
  }

  for (const c of chronicles ?? []) {
    recentWriting.push({
      source: "chronicle",
      text: trunc(
        [c.title, c.body].filter(Boolean).join(" — "),
        EDITORIAL_CONTEXT_CAPS.snippetChars,
      ),
      createdAt: c.publishedAt,
    });
  }

  for (const w of wallEntries ?? []) {
    recentWriting.push({
      source: "wall",
      text: trunc(w.body, EDITORIAL_CONTEXT_CAPS.snippetChars),
      createdAt: w.createdAt,
    });
  }

  if (speaks?.body) {
    recentWriting.push({
      source: "speaks",
      text: trunc(speaks.body, EDITORIAL_CONTEXT_CAPS.snippetChars),
      createdAt: speaks.publishedAt,
    });
  }

  // Bound total recent writing (editorial + other).
  const editorial = recentWriting.filter((r) => r.source === "editorial");
  const other = recentWriting.filter((r) => r.source !== "editorial");
  const boundedWriting = [
    ...editorial.slice(0, EDITORIAL_CONTEXT_CAPS.recentEditorialWriting),
    ...other.slice(0, EDITORIAL_CONTEXT_CAPS.otherRecentWriting),
  ];

  return {
    generatedAt: new Date(nowMs).toISOString(),
    coveredDate,
    newsroom: {
      headlines,
      notableActivity,
      quiet: world.quiet && headlines.length === 0,
    },
    worldState,
    protectedFacts,
    recentWriting: boundedWriting,
    editorialFocus: {
      whatMattersToday,
      keeperSituationalContext,
    },
    world,
    robinhood,
  };
}

/** Flatten day world facts for model user payload (safe facts only). */
export function worldContextFactCatalog(
  ctx: EditorialWorldContext,
): Record<string, string | number | boolean | null> {
  return {
    coveredDate: ctx.coveredDate,
    bookWritten: ctx.book.written,
    bookTitle: ctx.book.title,
    bookPreview: ctx.book.preview,
    fireWaitingCount: ctx.fireWaitingCount,
    gatheringTitle: ctx.gathering.activeTitle,
    gatheringState: ctx.gathering.stateLabel,
    newOutlaws: ctx.newOutlaws,
    deedSubmissionsApproved: ctx.deedSubmissionsApproved,
    deedsCreated: ctx.deedsCreated,
    greenwoodAdmissions: ctx.greenwoodAdmissions,
    wallInscriptions: ctx.wallInscriptions,
    campMessages: ctx.campMessages,
    campLeafRecognised: ctx.campLeafRecognised,
    leafRecognisedTotal: ctx.leafRecognisedTotal,
    leafRecognitionEvents: ctx.leafRecognitionEvents,
    fennXReplies: ctx.fennXReplies,
    fennWallWrites: ctx.fennWallWrites,
    commonsAllocationEvents: ctx.commonsAllocationEvents,
    commonsState: ctx.commonsState,
    treasuryState: ctx.treasuryState,
    quiet: ctx.quiet,
  };
}

/** Compact newsroom for Desk overview (not full JSON dump). */
export function newsroomHeadlinesForOverview(pack: EditorialContextPack): string[] {
  return pack.newsroom.headlines
    .slice(0, 5)
    .map((h) => trunc(h.headline, EDITORIAL_CONTEXT_CAPS.headlineChars));
}
