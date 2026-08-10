/**
 * Operator CLI: read-only launch funding preflight (no broadcast).
 *
 * Usage:
 *   npm run launch:fund-purse:preflight
 *
 * Never sends a transaction. Never mutates fenn_launch_operations.
 * Does not import the production broadcast path.
 */

export {};

async function main() {
  const {
    runFennLaunchFundPreflight,
    formatFennLaunchFundPreflightReport,
  } = await import("@/lib/ops/fenn-launch-fund-preflight");

  const report = await runFennLaunchFundPreflight();
  console.log(formatFennLaunchFundPreflightReport(report));

  if (report.result === "NOT_READY") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[launch:fund-purse:preflight] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
