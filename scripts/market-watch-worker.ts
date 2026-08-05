/**
 * Persistent Market Watch worker for Render.
 * Default mode disabled — safe until FENN_MARKET_WATCH_MODE is set.
 */

import { resolveMarketWatchRuntimeConfig } from "../src/lib/market-watch/config";
import { runMarketWatchWorkerLoop } from "../src/lib/market-watch/worker";

const runtime = resolveMarketWatchRuntimeConfig();
const controller = new AbortController();

function onSignal(signal: string) {
  console.info(
    JSON.stringify({
      domain: "market_watch",
      ts: new Date().toISOString(),
      event: "worker_stop",
      ok: true,
      detail: `signal=${signal}`,
    }),
  );
  controller.abort();
}

process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => onSignal("SIGINT"));

runMarketWatchWorkerLoop({
  runtime,
  signal: controller.signal,
})
  .then((result) => {
    console.info(
      JSON.stringify({
        domain: "market_watch",
        ts: new Date().toISOString(),
        event: "worker_exit",
        ok: true,
        detail: `ticks=${result.ticks} reason=${result.stoppedReason}`,
      }),
    );
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        domain: "market_watch",
        ts: new Date().toISOString(),
        event: "worker_exit",
        ok: false,
        code: error instanceof Error ? error.message : "unknown",
      }),
    );
    process.exit(1);
  });
