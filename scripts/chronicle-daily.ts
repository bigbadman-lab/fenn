/**
 * Manual / ops Living Book daily writer.
 *
 * Usage:
 *   npm run chronicle:daily
 *   npm run chronicle:daily -- --date=2026-07-28
 *   npm run chronicle:daily -- --date=2026-07-28 --dry-run
 */
import { previousUtcCalendarDay } from "@/lib/chronicle/dates";
import { ChronicleError } from "@/lib/chronicle/errors";
import { runDailyChronicle } from "@/lib/chronicle/run-daily";

function parseArgs(argv: string[]) {
  let date: string | undefined;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "--dryRun") dryRun = true;
    else if (arg.startsWith("--date=")) date = arg.slice("--date=".length).trim();
  }
  return { date, dryRun };
}

async function main() {
  const { date, dryRun } = parseArgs(process.argv.slice(2));
  const coveredDate = date || previousUtcCalendarDay();

  console.log(`[chronicle:daily] coveredDate=${coveredDate} dryRun=${dryRun}`);

  const result = await runDailyChronicle({ coveredDate, dryRun });

  console.log(
    JSON.stringify(
      {
        coveredDate: result.coveredDate,
        created: result.created,
        dryRun: result.dryRun,
        quiet: result.snapshot.quiet,
        entryId: result.entry?.id ?? null,
        title: result.generated?.title ?? result.entry?.title ?? null,
        snapshot: {
          newOutlaws: result.snapshot.newOutlaws,
          campMessages: result.snapshot.campMessages,
          leafRecognisedTotal: result.snapshot.leafRecognisedTotal,
          deedSubmissionsApproved: result.snapshot.deedSubmissionsApproved,
          greenwoodAdmissions: result.snapshot.greenwoodAdmissions,
          wallInscriptions: result.snapshot.wallInscriptions,
          fennXReplies: result.snapshot.fennXReplies,
          fennWallWrites: result.snapshot.fennWallWrites,
        },
        previewBody: dryRun ? result.generated?.body ?? null : undefined,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  if (error instanceof ChronicleError) {
    console.error(`[chronicle:daily] ${error.code}: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
