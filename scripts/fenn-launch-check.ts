/**
 * P2C.1 — FENN launch readiness (read-only).
 *
 * Usage:
 *   npm run launch:check
 *
 * Never writes DB, never claims effects, never broadcasts, never activates.
 */

async function main() {
  const { runFennLaunchCheck, formatFennLaunchCheckReport } = await import(
    "@/lib/ops/fenn-launch-check"
  );
  const report = await runFennLaunchCheck();
  console.log(formatFennLaunchCheckReport(report));
  if (report.status === "CONFIG_ERROR") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[launch:check] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
