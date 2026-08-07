import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatUtcDate, isUtcDateString } from "@/lib/chronicle/dates";
import {
  buildEditorialContextPack,
  newsroomHeadlinesForOverview,
  worldContextFactCatalog,
} from "@/lib/editorial/context-pack";
import { EditorialError } from "@/lib/editorial/errors";
import type {
  EditorialDailyOverview,
  EditorialWorldContext,
} from "@/lib/editorial/types";

export { worldContextFactCatalog };

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
 * Built from the newsroom context pack when possible.
 */
export async function buildEditorialDailyOverview(
  coveredDate: string,
  options?: {
    admin?: SupabaseClient;
    nowMs?: number;
    whatMattersToday?: string | null;
  },
): Promise<EditorialDailyOverview> {
  if (!isUtcDateString(coveredDate)) {
    throw new EditorialError(
      "editorial_invalid_input",
      "Invalid covered date",
      400,
    );
  }

  const pack = await buildEditorialContextPack({
    coveredDate,
    admin: options?.admin,
    nowMs: options?.nowMs,
    whatMattersToday: options?.whatMattersToday,
  });

  const snapshot = pack.world;
  const treasuryState = snapshot.treasuryState;
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
    bookWritten: snapshot.book.written,
    fireWaitingCount: snapshot.fireWaitingCount,
    gatheringLabel: snapshot.gathering.activeTitle ?? "None open",
    newOutlaws: snapshot.newOutlaws,
    newDeedsApproved: snapshot.deedSubmissionsApproved,
    greenwoodArrivals: snapshot.greenwoodAdmissions,
    wallMarks: snapshot.wallInscriptions,
    treasuryLabel,
    robinhoodLabel,
    campMessages: snapshot.campMessages,
    leafRecognitionEvents: snapshot.leafRecognitionEvents,
    quiet: snapshot.quiet,
    newsroomHeadlines: newsroomHeadlinesForOverview(pack),
    liveSurfaces: pack.worldState.liveSurfaces,
    generatedAt: pack.generatedAt,
  };
}

/**
 * Trusted generator day-count context (via context pack).
 */
export async function buildEditorialWorldContext(
  coveredDate: string,
  options?: {
    admin?: SupabaseClient;
    nowMs?: number;
    whatMattersToday?: string | null;
  },
): Promise<EditorialWorldContext> {
  if (!isUtcDateString(coveredDate)) {
    throw new EditorialError(
      "editorial_invalid_input",
      "Invalid covered date",
      400,
    );
  }
  const pack = await buildEditorialContextPack({
    coveredDate,
    admin: options?.admin ?? (await defaultAdmin()),
    nowMs: options?.nowMs,
    whatMattersToday: options?.whatMattersToday,
  });
  return pack.world;
}

/** Today's covered date in UTC. */
export function editorialCoveredDateToday(now: Date = new Date()): string {
  return formatUtcDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
  );
}
