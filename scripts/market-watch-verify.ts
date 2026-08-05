/**
 * Dry-run explorer verification CLI.
 *
 * Usage:
 *   npm run market-watch:verify -- --from-block 100 --to-block 200
 *
 * Never publishes. Never advances cursor. Never logs RPC URLs.
 */

import {
  parseVerifyArgs,
  runMarketWatchVerify,
} from "../src/lib/market-watch/verify";

async function main() {
  const args = parseVerifyArgs(process.argv.slice(2));
  const report = await runMarketWatchVerify({
    ...args,
    allowDisabledConfig: true,
  });
  console.info(JSON.stringify({ domain: "market_watch", event: "verify_report", ...report }));
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      domain: "market_watch",
      event: "verify_report",
      ok: false,
      code: error instanceof Error ? error.message : "unknown",
    }),
  );
  process.exit(1);
});
