/**
 * Manual Market Watch replay CLI.
 *
 * Usage:
 *   npm run market-watch:replay -- --from-block 100 --to-block 200
 *   npm run market-watch:replay -- --from-block 100 --to-block 200 --mode dry_run
 *   npm run market-watch:replay -- --from-block 100 --to-block 200 --mode live --live-replay
 */

import { parseReplayArgs, runMarketWatchReplay } from "../src/lib/market-watch/replay";

async function main() {
  const args = parseReplayArgs(process.argv.slice(2));
  const result = await runMarketWatchReplay(args);
  console.info(
    JSON.stringify({
      domain: "market_watch",
      event: "replay_done",
      ok: true,
      ...result,
      fromBlock: result.fromBlock.toString(),
      toBlock: result.toBlock.toString(),
      cursorAdvancedTo: result.cursorAdvancedTo?.toString() ?? null,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      domain: "market_watch",
      event: "replay_done",
      ok: false,
      code: error instanceof Error ? error.message : "unknown",
    }),
  );
  process.exit(1);
});
