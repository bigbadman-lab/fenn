import "server-only";

import { buildEditorialBriefFromPack } from "@/lib/editorial/brief";
import {
  buildEditorialContextPack,
  newsroomHeadlinesForOverview,
} from "@/lib/editorial/context-pack";
import {
  categoryForMode,
  isEditorialMode,
  type EditorialMode,
} from "@/lib/editorial/categories";
import { EditorialError } from "@/lib/editorial/errors";
import {
  generateEditorialPackage,
  generateEditorialSingle,
  generateEditorialKeeperSpeak,
  type EditorialModelCaller,
} from "@/lib/editorial/generate";
import {
  findLatestEditorialRunForDate,
  getEditorialTransmissionById,
  persistEditorialRun,
  replaceTransmissionDraft,
} from "@/lib/editorial/store";
import type {
  EditorialDailyOverview,
  EditorialDraftTransmission,
  EditorialRoomSnapshot,
  SafeEditorialRun,
  SafeEditorialTransmission,
} from "@/lib/editorial/types";
import { EDITORIAL_KEEPER_CONTEXT_MAX_CHARS } from "@/lib/editorial/types";
import {
  buildEditorialDailyOverview,
  editorialCoveredDateToday,
} from "@/lib/editorial/world-context";

function overviewFromPack(
  pack: Awaited<ReturnType<typeof buildEditorialContextPack>>,
): EditorialDailyOverview {
  const snapshot = pack.world;
  const treasuryState = snapshot.treasuryState;
  const treasuryLabel =
    snapshot.commonsAllocationEvents === 0 &&
    snapshot.leafRecognitionEvents === 0
      ? treasuryState === "ready"
        ? "No change"
        : treasuryState === "unconfigured"
          ? "Unconfigured"
          : treasuryState === "unavailable"
            ? "Unavailable"
            : "No change"
      : treasuryState === "ready"
        ? "Readable"
        : treasuryState === "unconfigured"
          ? "Unconfigured"
          : treasuryState === "unavailable"
            ? "Unavailable"
            : "No change";

  return {
    coveredDate: pack.coveredDate,
    bookWritten: snapshot.book.written,
    fireWaitingCount: snapshot.fireWaitingCount,
    gatheringLabel: snapshot.gathering.activeTitle ?? "None open",
    newOutlaws: snapshot.newOutlaws,
    newDeedsApproved: snapshot.deedSubmissionsApproved,
    greenwoodArrivals: snapshot.greenwoodAdmissions,
    wallMarks: snapshot.wallInscriptions,
    treasuryLabel,
    robinhoodLabel: treasuryState === "ready" ? "Signals available" : "Quiet",
    campMessages: snapshot.campMessages,
    leafRecognitionEvents: snapshot.leafRecognitionEvents,
    quiet: snapshot.quiet,
    newsroomHeadlines: newsroomHeadlinesForOverview(pack),
    liveSurfaces: pack.worldState.liveSurfaces,
    generatedAt: pack.generatedAt,
  };
}

/**
 * Editorial Room bootstrap: overview + latest run for today.
 */
export async function getEditorialRoomSnapshot(
  now: Date = new Date(),
): Promise<EditorialRoomSnapshot> {
  const coveredDate = editorialCoveredDateToday(now);
  const overview = await buildEditorialDailyOverview(coveredDate, {
    nowMs: now.getTime(),
  });
  const latestRun = await findLatestEditorialRunForDate(coveredDate);
  return { overview, latestRun };
}

/**
 * Prepare today's full package: one model call (+ optional one recovery), persist.
 */
export async function prepareTodaysEditorialPackage(input: {
  createdBy: string;
  coveredDate?: string;
  whatMattersToday?: string | null;
  caller?: EditorialModelCaller;
  now?: Date;
}): Promise<SafeEditorialRun> {
  const now = input.now ?? new Date();
  const coveredDate =
    input.coveredDate ?? editorialCoveredDateToday(now);

  const pack = await buildEditorialContextPack({
    coveredDate,
    whatMattersToday: input.whatMattersToday,
    nowMs: now.getTime(),
  });
  const brief = buildEditorialBriefFromPack(pack);
  const overview = overviewFromPack(pack);

  const generated = await generateEditorialPackage({
    pack,
    brief,
    caller: input.caller,
  });

  return persistEditorialRun({
    coveredDate,
    createdBy: input.createdBy,
    worldSummary: overview,
    robinhoodSummary: pack.robinhood,
    editorialBrief: generated.brief,
    transmissions: generated.transmissions,
  });
}

function legacyModeFromCategory(
  category: SafeEditorialTransmission["category"],
): EditorialMode {
  if (category === "lore") return "world_lore";
  if (category === "ascii") return "wild";
  if (category === "invitation") return "outlaw";
  if (category === "founder_note") return "direct";
  if (category === "robinhood_echo") return "agent";
  return "explanation";
}

/**
 * Regenerate a single transmission slot.
 */
export async function regenerateEditorialTransmission(input: {
  transmissionId: string;
  caller?: EditorialModelCaller;
}): Promise<SafeEditorialTransmission> {
  const { run, transmission } = await getEditorialTransmissionById(
    input.transmissionId,
  );

  const whatMattersToday = run.editorialBrief?.whatMattersToday ?? null;

  const pack = await buildEditorialContextPack({
    coveredDate: run.coveredDate,
    whatMattersToday,
  });
  const brief = run.editorialBrief ?? buildEditorialBriefFromPack(pack);

  const mode =
    transmission.mode && isEditorialMode(transmission.mode)
      ? transmission.mode
      : legacyModeFromCategory(transmission.category);

  const avoidBodies = run.transmissions
    .filter((t) => t.id !== transmission.id)
    .flatMap((t) => [t.originalBody, t.body]);

  const draft = await generateEditorialSingle({
    mode,
    pack,
    brief,
    avoidBodies,
    caller: input.caller,
  });

  const finalDraft = {
    ...draft,
    mode,
    category: categoryForMode(mode),
  };

  return replaceTransmissionDraft({
    transmissionId: input.transmissionId,
    draft: finalDraft,
  });
}

/**
 * Speak-once for the Keeper: one draft, no run/package persistence, no X post.
 */
export async function speakOnceForKeeper(input: {
  keeperContext: string;
  caller?: EditorialModelCaller;
  now?: Date;
}): Promise<{
  transmission: EditorialDraftTransmission;
  recoveryUsed: boolean;
}> {
  const trimmed = input.keeperContext.trim();
  if (!trimmed) {
    throw new EditorialError(
      "editorial_invalid_input",
      "Keeper context is required",
      400,
    );
  }
  if (trimmed.length > EDITORIAL_KEEPER_CONTEXT_MAX_CHARS) {
    throw new EditorialError(
      "editorial_invalid_input",
      `Keeper context must be at most ${EDITORIAL_KEEPER_CONTEXT_MAX_CHARS} characters`,
      400,
    );
  }

  const now = input.now ?? new Date();
  const pack = await buildEditorialContextPack({
    keeperSituationalContext: trimmed,
    nowMs: now.getTime(),
  });
  const brief = buildEditorialBriefFromPack(pack);

  const avoidBodies = pack.recentWriting
    .map((w) => w.text)
    .filter((b) => b.trim().length > 0);

  const { draft, recoveryUsed } = await generateEditorialKeeperSpeak({
    pack,
    brief,
    avoidBodies,
    caller: input.caller,
  });

  return { transmission: draft, recoveryUsed };
}

export function assertEditorialConfiguredOrExplain(error: unknown): never {
  if (error instanceof EditorialError) throw error;
  throw new EditorialError(
    "editorial_unavailable",
    "Editorial Room could not complete this action",
    503,
  );
}
