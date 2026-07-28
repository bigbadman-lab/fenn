import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { previousUtcCalendarDay } from "@/lib/chronicle/dates";
import { ChronicleError } from "@/lib/chronicle/errors";
import {
  DAILY_CHRONICLE_OPENAI_MODEL,
  generateDailyChronicle,
  type DailyChronicleModelCaller,
} from "@/lib/chronicle/generate";
import { findDailyChronicleByCoveredDate } from "@/lib/chronicle/read";
import { buildDailyWorldSnapshot } from "@/lib/chronicle/snapshot";
import type {
  DailyWorldSnapshot,
  GeneratedDailyChronicle,
  PublicChronicleEntry,
} from "@/lib/chronicle/types";
import { writeDailyChronicleEntry } from "@/lib/chronicle/write";

export type RunDailyChronicleResult = {
  coveredDate: string;
  created: boolean;
  dryRun: boolean;
  snapshot: DailyWorldSnapshot;
  generated: GeneratedDailyChronicle | null;
  entry: PublicChronicleEntry | null;
};

/**
 * Domain entrypoint shared by CLI and cron.
 * Does not execute Stage 12 effects.
 */
export async function runDailyChronicle(options?: {
  coveredDate?: string;
  dryRun?: boolean;
  now?: Date;
  admin?: SupabaseClient;
  caller?: DailyChronicleModelCaller;
}): Promise<RunDailyChronicleResult> {
  const coveredDate =
    options?.coveredDate ?? previousUtcCalendarDay(options?.now ?? new Date());
  const dryRun = options?.dryRun === true;

  const existing = await findDailyChronicleByCoveredDate(coveredDate, {
    admin: options?.admin,
  });
  if (existing && !dryRun) {
    const snapshot = await buildDailyWorldSnapshot(coveredDate, {
      admin: options?.admin,
    });
    return {
      coveredDate,
      created: false,
      dryRun: false,
      snapshot,
      generated: null,
      entry: existing,
    };
  }

  const snapshot = await buildDailyWorldSnapshot(coveredDate, {
    admin: options?.admin,
  });

  const generated = await generateDailyChronicle(snapshot, {
    caller: options?.caller,
  });

  if (dryRun) {
    return {
      coveredDate,
      created: false,
      dryRun: true,
      snapshot,
      generated,
      entry: null,
    };
  }

  const persisted = await writeDailyChronicleEntry(
    {
      coveredDate,
      title: generated.title,
      body: generated.body,
      snapshot,
      referencedFacts: generated.referencedFacts,
      tone: generated.tone,
      model: DAILY_CHRONICLE_OPENAI_MODEL,
    },
    { admin: options?.admin },
  );

  return {
    coveredDate,
    created: persisted.created,
    dryRun: false,
    snapshot,
    generated,
    entry: persisted.entry,
  };
}

export function assertDailyRunnerHasNoStage12Effects(source: string): void {
  if (/executePending|claimXPerceptionEffect|writeFennWallEntry/i.test(source)) {
    throw new ChronicleError(
      "chronicle_invalid_input",
      "Daily chronicle runner must not execute Stage 12 effects",
      500,
    );
  }
}
