/**
 * Long-running Market Watch worker loop for Render (not X-agent cron).
 */

import "server-only";

import {
  resolveMarketWatchRuntimeConfig,
  type MarketWatchRuntimeConfig,
} from "@/lib/market-watch/config";
import { logMarketWatch } from "@/lib/market-watch/log";
import { runMarketWatchTick } from "@/lib/market-watch/tick";
import {
  releaseOpsRuntimeLease,
  tryAcquireOpsRuntimeLease,
  type RuntimeLeaseDeps,
} from "@/lib/ops/x-agent-lease";

export type WorkerLoopOptions = {
  runtime?: MarketWatchRuntimeConfig;
  /** Injected sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Stop after N ticks (tests). 0 = unlimited. */
  maxTicks?: number;
  /** Abort signal for graceful stop. */
  signal?: AbortSignal;
  lease?: RuntimeLeaseDeps;
  tick?: typeof runMarketWatchTick;
  log?: typeof logMarketWatch;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Acquire lease, tick until disabled sleep or signal, renew lease each tick.
 */
export async function runMarketWatchWorkerLoop(
  options: WorkerLoopOptions = {},
): Promise<{ ticks: number; stoppedReason: string }> {
  const runtime = options.runtime ?? resolveMarketWatchRuntimeConfig();
  const sleep = options.sleep ?? defaultSleep;
  const tickFn = options.tick ?? runMarketWatchTick;
  const log = options.log ?? logMarketWatch;
  const maxTicks = options.maxTicks ?? 0;

  log({
    event: "worker_start",
    ok: true,
    mode: runtime.mode,
    detail: `version=${runtime.workerVersion} poll=${runtime.pollSeconds}s`,
  });

  let ticks = 0;
  let holderId: string | null = null;
  let leaseKey = runtime.leaseKey;

  const shouldStop = () =>
    options.signal?.aborted === true ||
    (maxTicks > 0 && ticks >= maxTicks);

  try {
    while (!shouldStop()) {
      // Refresh lease each tick so multi-instance safety holds.
      const lease = await tryAcquireOpsRuntimeLease(
        {
          leaseKey: runtime.leaseKey,
          ttlSeconds: runtime.leaseTtlSeconds,
          holderId: holderId ?? undefined,
        },
        options.lease,
      );
      leaseKey = lease.leaseKey;
      holderId = lease.holderId;

      if (!lease.acquired) {
        log({
          event: "lease_skipped",
          ok: true,
          mode: runtime.mode,
          code: "busy",
        });
        await sleep(runtime.pollSeconds * 1000);
        ticks += 1;
        continue;
      }

      if (ticks === 0 || !holderId) {
        log({
          event: "lease_acquired",
          ok: true,
          mode: runtime.mode,
        });
      }

      await tickFn(runtime, { leaseHolder: holderId });
      ticks += 1;

      if (shouldStop()) break;
      await sleep(runtime.pollSeconds * 1000);
    }
  } finally {
    if (holderId) {
      try {
        await releaseOpsRuntimeLease(
          { leaseKey, holderId },
          options.lease,
        );
      } catch {
        // ignore release errors on shutdown
      }
    }
    log({
      event: "worker_stop",
      ok: true,
      mode: runtime.mode,
      detail: `ticks=${ticks}`,
    });
  }

  return {
    ticks,
    stoppedReason: options.signal?.aborted ? "signal" : "max_ticks",
  };
}
