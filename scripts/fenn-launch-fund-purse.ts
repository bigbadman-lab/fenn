/**
 * Operator CLI: one-shot 10,000,000 FENN Treasury → Purse launch funding.
 *
 * Usage:
 *   npm run launch:fund-purse
 *
 * Requires local FENN_TREASURY_PRIVATE_KEY (must match treasury_config).
 * No amount/token/recipient CLI args. Private key never printed.
 */

export {};

async function main() {
  const {
    runFennLaunchFundPurse,
    formatFennLaunchFundReport,
  } = await import("@/lib/ops/fenn-launch-fund-purse");

  const report = await runFennLaunchFundPurse();
  console.log(formatFennLaunchFundReport(report));

  if (
    report.status === "REFUSED" ||
    report.status === "FAILED" ||
    report.status === "AMBIGUOUS"
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[launch:fund-purse] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
