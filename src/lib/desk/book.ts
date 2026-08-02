import "server-only";

import {
  formatUtcDate,
  isUtcDateString,
  previousUtcCalendarDay,
} from "@/lib/chronicle/dates";
import { ChronicleError } from "@/lib/chronicle/errors";
import {
  findDailyChronicleByCoveredDate,
  listPublicChronicleEntries,
} from "@/lib/chronicle/read";
import { runDailyChronicle } from "@/lib/chronicle/run-daily";
import type { PublicChronicleEntry } from "@/lib/chronicle/types";

const RECENT_DAYS = 7;
const PREVIEW_CHARS = 280;

export type DeskBookEntrySummary = {
  id: string;
  kind: string;
  title: string | null;
  coveredDate: string | null;
  publishedAt: string;
  preview: string;
};

export type DeskBookDayStatus = {
  coveredDate: string;
  state: "written" | "missing";
  entryId: string | null;
};

export type DeskBookHealth = {
  yesterday: DeskBookDayStatus;
  today: DeskBookDayStatus;
  latest: DeskBookEntrySummary | null;
  recentDays: DeskBookDayStatus[];
  gapCount: number;
  cronHint: string;
  serverNow: string;
};

function previewBody(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  if (trimmed.length <= PREVIEW_CHARS) return trimmed;
  return `${trimmed.slice(0, PREVIEW_CHARS)}…`;
}

function toSummary(entry: PublicChronicleEntry): DeskBookEntrySummary {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    coveredDate: entry.coveredDate,
    publishedAt: entry.publishedAt,
    preview: previewBody(entry.body),
  };
}

function utcToday(now = new Date()): string {
  return formatUtcDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
  );
}

function shiftUtcDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatUtcDate(dt);
}

async function dayStatus(coveredDate: string): Promise<DeskBookDayStatus> {
  const entry = await findDailyChronicleByCoveredDate(coveredDate);
  return {
    coveredDate,
    state: entry ? "written" : "missing",
    entryId: entry?.id ?? null,
  };
}

export async function getDeskBookHealth(
  now: Date = new Date(),
): Promise<DeskBookHealth> {
  const yesterdayDate = previousUtcCalendarDay(now);
  const todayDate = utcToday(now);
  const recentDates = Array.from({ length: RECENT_DAYS }, (_, i) =>
    shiftUtcDate(yesterdayDate, -i),
  );

  const [yesterday, today, recentDays, latestEntries] = await Promise.all([
    dayStatus(yesterdayDate),
    dayStatus(todayDate),
    Promise.all(recentDates.map((d) => dayStatus(d))),
    listPublicChronicleEntries({ limit: 5 }),
  ]);

  const gapCount = recentDays.filter((d) => d.state === "missing").length;

  return {
    yesterday,
    today,
    latest: latestEntries[0] ? toSummary(latestEntries[0]) : null,
    recentDays,
    gapCount,
    cronHint:
      "Daily generation may be scheduled in deployment. This page does not prove a successful cron run.",
    serverNow: now.toISOString(),
  };
}

export async function getDeskBookEntryByDate(
  coveredDate: string,
): Promise<DeskBookEntrySummary | null> {
  if (!isUtcDateString(coveredDate)) {
    throw new ChronicleError(
      "chronicle_unavailable",
      "Invalid covered date",
      400,
    );
  }
  const entry = await findDailyChronicleByCoveredDate(coveredDate);
  return entry ? toSummary(entry) : null;
}

export type DeskBookGenerateResult = {
  coveredDate: string;
  created: boolean;
  existed: boolean;
  entry: DeskBookEntrySummary | null;
  mode: "created" | "already_exists" | "refused";
};

/**
 * Fill-if-missing only. Never overwrites an existing daily entry.
 */
export async function deskGenerateBookEntry(input: {
  coveredDate: string;
}): Promise<DeskBookGenerateResult> {
  if (!isUtcDateString(input.coveredDate)) {
    throw new ChronicleError(
      "chronicle_unavailable",
      "Invalid covered date",
      400,
    );
  }

  const existing = await findDailyChronicleByCoveredDate(input.coveredDate);
  if (existing) {
    return {
      coveredDate: input.coveredDate,
      created: false,
      existed: true,
      entry: toSummary(existing),
      mode: "already_exists",
    };
  }

  const result = await runDailyChronicle({
    coveredDate: input.coveredDate,
    dryRun: false,
  });

  return {
    coveredDate: result.coveredDate,
    created: result.created,
    existed: !result.created,
    entry: result.entry ? toSummary(result.entry) : null,
    mode: result.created ? "created" : "already_exists",
  };
}
