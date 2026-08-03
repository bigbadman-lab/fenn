import "server-only";

import { buildEditorialBrief } from "@/lib/editorial/brief";
import { EditorialError } from "@/lib/editorial/errors";
import {
  generateEditorialPackage,
  generateEditorialSingle,
  type EditorialModelCaller,
} from "@/lib/editorial/generate";
import { buildEditorialRobinhoodContext } from "@/lib/editorial/robinhood-context";
import {
  findLatestEditorialRunForDate,
  getEditorialTransmissionById,
  persistEditorialRun,
  replaceTransmissionDraft,
} from "@/lib/editorial/store";
import type {
  EditorialRoomSnapshot,
  SafeEditorialRun,
  SafeEditorialTransmission,
} from "@/lib/editorial/types";
import {
  buildEditorialDailyOverview,
  buildEditorialWorldContext,
  editorialCoveredDateToday,
} from "@/lib/editorial/world-context";

/**
 * Editorial Room bootstrap: overview + latest run for today.
 */
export async function getEditorialRoomSnapshot(
  now: Date = new Date(),
): Promise<EditorialRoomSnapshot> {
  const coveredDate = editorialCoveredDateToday(now);
  const overview = await buildEditorialDailyOverview(coveredDate);
  const latestRun = await findLatestEditorialRunForDate(coveredDate);
  return { overview, latestRun };
}

/**
 * Prepare today's full package: one model call, persist run + 24 drafts.
 */
export async function prepareTodaysEditorialPackage(input: {
  createdBy: string;
  coveredDate?: string;
  caller?: EditorialModelCaller;
  now?: Date;
}): Promise<SafeEditorialRun> {
  const coveredDate =
    input.coveredDate ?? editorialCoveredDateToday(input.now ?? new Date());

  const world = await buildEditorialWorldContext(coveredDate);
  const robinhood = buildEditorialRobinhoodContext(world);
  const brief = buildEditorialBrief(world, robinhood);
  const overview = await buildEditorialDailyOverview(coveredDate);

  const generated = await generateEditorialPackage({
    world,
    robinhood,
    brief,
    caller: input.caller,
  });

  return persistEditorialRun({
    coveredDate,
    createdBy: input.createdBy,
    worldSummary: overview,
    robinhoodSummary: robinhood,
    editorialBrief: generated.brief,
    transmissions: generated.transmissions,
  });
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

  const world = await buildEditorialWorldContext(run.coveredDate);
  const robinhood = buildEditorialRobinhoodContext(world);
  const brief = run.editorialBrief ?? buildEditorialBrief(world, robinhood);

  const avoidBodies = run.transmissions
    .filter((t) => t.category === transmission.category)
    .flatMap((t) => [t.originalBody, t.body]);

  const draft = await generateEditorialSingle({
    category: transmission.category,
    world,
    robinhood,
    brief,
    avoidBodies,
    caller: input.caller,
  });

  return replaceTransmissionDraft({
    transmissionId: input.transmissionId,
    draft,
  });
}

export function assertEditorialConfiguredOrExplain(error: unknown): never {
  if (error instanceof EditorialError) throw error;
  throw new EditorialError(
    "editorial_unavailable",
    "Editorial Room could not complete this action",
    503,
  );
}
