import { NextResponse } from "next/server";

import { previousUtcCalendarDay } from "@/lib/chronicle/dates";
import { ChronicleError } from "@/lib/chronicle/errors";
import { runDailyChronicle } from "@/lib/chronicle/run-daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Protected daily Living Book writer.
 * Intended for Vercel Cron / manual authenticated invoke.
 * Uses the same domain function as `npm run chronicle:daily`.
 *
 * Schedule intent: shortly after UTC midnight → previous UTC calendar day.
 */
function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const expected = `Bearer ${secret}`;
  return header === expected;
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const dryRun = url.searchParams.get("dryRun") === "1";
  const coveredDate = dateParam?.trim() || previousUtcCalendarDay();

  try {
    const result = await runDailyChronicle({
      coveredDate,
      dryRun,
    });

    return NextResponse.json({
      ok: true,
      coveredDate: result.coveredDate,
      created: result.created,
      dryRun: result.dryRun,
      entryId: result.entry?.id ?? null,
      quiet: result.snapshot.quiet,
      // Do not expose full snapshot or model body to cron responses by default.
    });
  } catch (error) {
    const status = error instanceof ChronicleError ? error.status : 500;
    const message =
      error instanceof ChronicleError
        ? error.message
        : error instanceof Error
          ? error.message
          : "chronicle failed";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
