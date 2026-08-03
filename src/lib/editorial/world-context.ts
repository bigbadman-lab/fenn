import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatUtcDate, isUtcDateString, utcDayBounds } from "@/lib/chronicle/dates";
import { findDailyChronicleByCoveredDate } from "@/lib/chronicle/read";
import { buildDailyWorldSnapshot } from "@/lib/chronicle/snapshot";
import { getPublicCommonsSnapshot } from "@/lib/commons/snapshot";
import { EditorialError } from "@/lib/editorial/errors";
import type {
  EditorialDailyOverview,
  EditorialWorldContext,
} from "@/lib/editorial/types";
import { getDeskFireSnapshot } from "@/lib/desk/fire";
import { getPublicTreasurySnapshot } from "@/lib/treasury/snapshot";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function treasuryLabelFromState(state: string): string {
  if (state === "ready") return "Readable";
  if (state === "unconfigured") return "Unconfigured";
  if (state === "unavailable") return "Unavailable";
  return "No change";
}

/**
 * Assemble operator-safe world overview for the Editorial Room shell.
 * Counts and public labels only — no wallets, emails, or conversation bodies.
 */
export async function buildEditorialDailyOverview(
  coveredDate: string,
  options?: { admin?: SupabaseClient; nowMs?: number },
): Promise<EditorialDailyOverview> {
  if (!isUtcDateString(coveredDate)) {
    throw new EditorialError(
      "editorial_invalid_input",
      "Invalid covered date",
      400,
    );
  }

  const admin = options?.admin ?? (await defaultAdmin());
  const nowMs = options?.nowMs ?? Date.now();

  const [snapshot, book, fire, treasury] = await Promise.all([
    buildDailyWorldSnapshot(coveredDate, { admin }),
    findDailyChronicleByCoveredDate(coveredDate),
    getDeskFireSnapshot(nowMs),
    getPublicTreasurySnapshot().catch(() => null),
  ]);

  const gatheringLabel = fire.activeGathering
    ? fire.activeGathering.title
    : "None open";

  const treasuryState = treasury?.state ?? "unconfigured";
  const treasuryLabel =
    snapshot.commonsAllocationEvents === 0 && snapshot.leafRecognitionEvents === 0
      ? treasuryState === "ready"
        ? "No change"
        : treasuryLabelFromState(treasuryState)
      : treasuryLabelFromState(treasuryState);

  const robinhoodLabel =
    treasuryState === "ready" ? "Signals available" : "Quiet";

  return {
    coveredDate,
    bookWritten: Boolean(book),
    fireWaitingCount: fire.sittingCount,
    gatheringLabel,
    newOutlaws: snapshot.newOutlaws,
    newDeedsApproved: snapshot.deedSubmissionsApproved,
    greenwoodArrivals: snapshot.greenwoodAdmissions,
    wallMarks: snapshot.wallInscriptions,
    treasuryLabel,
    robinhoodLabel,
    campMessages: snapshot.campMessages,
    leafRecognitionEvents: snapshot.leafRecognitionEvents,
    quiet: snapshot.quiet,
  };
}

/**
 * Trusted generator context — factual only.
 * Never includes private camp transcripts, wallets, or moderation notes.
 */
export async function buildEditorialWorldContext(
  coveredDate: string,
  options?: { admin?: SupabaseClient; nowMs?: number },
): Promise<EditorialWorldContext> {
  if (!isUtcDateString(coveredDate)) {
    throw new EditorialError(
      "editorial_invalid_input",
      "Invalid covered date",
      400,
    );
  }

  const admin = options?.admin ?? (await defaultAdmin());
  const nowMs = options?.nowMs ?? Date.now();

  // Touch day bounds so invalid date throws early (UTC only).
  utcDayBounds(coveredDate);

  const [snapshot, book, fire, treasury, commons] = await Promise.all([
    buildDailyWorldSnapshot(coveredDate, { admin }),
    findDailyChronicleByCoveredDate(coveredDate),
    getDeskFireSnapshot(nowMs),
    getPublicTreasurySnapshot().catch(() => null),
    getPublicCommonsSnapshot().catch(() => null),
  ]);

  const bookPreview = book
    ? book.body.trim().replace(/\s+/g, " ").slice(0, 240)
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
  ];

  return {
    coveredDate,
    book: {
      written: Boolean(book),
      title: book?.title ?? null,
      preview: bookPreview,
    },
    fireWaitingCount: fire.sittingCount,
    gathering: {
      activeTitle: fire.activeGathering?.title ?? null,
      stateLabel: fire.activeGathering ? "open" : "none",
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
  };
}

/** Today's covered date in UTC. */
export function editorialCoveredDateToday(now: Date = new Date()): string {
  return formatUtcDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
  );
}

/** Flatten world context for the model user payload (safe facts only). */
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
