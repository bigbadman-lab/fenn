/**
 * P2C.2 — One-command official $VELL contract configuration.
 *
 * Usage:
 *   npm run vell:activate -- --contract 0x…
 *   npm run launch:activate -- --contract 0x…   (alias)
 *
 * Writes treasury_assets.contract_address on the dormant official row.
 * Homepage header polls /api/home/official-token — no redeploy required.
 */

// Force ES module scope so Next/tsc does not merge `main` with sibling scripts.
export {};

async function main() {
  const { parseContractCliArg, runFennLaunchActivate, formatFennLaunchActivateReport } =
    await import("@/lib/ops/fenn-launch-activate");

  const { present, value } = parseContractCliArg(process.argv.slice(2));
  const report = await runFennLaunchActivate({
    contract: present ? value : null,
  });

  console.log(formatFennLaunchActivateReport(report));

  if (report.status === "REFUSED") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[launch:activate] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
