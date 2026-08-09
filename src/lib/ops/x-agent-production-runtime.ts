/**
 * Production entry for Render Cron: mode gate, lease, bounds, summary logging.
 * Does not redesign Stage 12 — wraps the existing one-shot pipeline.
 */

import "server-only";

import {
  resolveXAgentExecutionConfig,
  type FennXAgentExecutionMode,
  type XAgentExecutionConfig,
} from "@/lib/ops/x-agent-execution-config";
import {
  releaseOpsRuntimeLease,
  tryAcquireOpsRuntimeLease,
  type RuntimeLeaseDeps,
} from "@/lib/ops/x-agent-lease";
import {
  formatXAgentRunSummary,
  type XAgentRunSummaryResultCode,
} from "@/lib/ops/x-agent-summary";
import { probeXAgentInternalWork } from "@/lib/ops/x-agent-work-probe";
import {
  runXAgentPipeline,
  type XPipelineRunResult,
  type XPipelineRuntimeDeps,
} from "@/lib/ops/x-pipeline-runtime";
import {
  executePendingXPerceptionEffects,
  type ExecuteBatchAggregate,
} from "@/lib/agent/stage126-execute";
import { STAGE126_SPEECH_EFFECT_TYPES } from "@/lib/agent/execute-config";

export type XAgentProductionRunResult = {
  ok: boolean;
  mode: FennXAgentExecutionMode;
  result: XAgentRunSummaryResultCode;
  durationMs: number;
  summary: string;
  pipeline?: XPipelineRunResult;
  config: XAgentExecutionConfig;
};

export type XAgentProductionRuntimeDeps = {
  config?: XAgentExecutionConfig;
  log?: (line: string) => void;
  now?: () => number;
  lease?: RuntimeLeaseDeps;
  /** Pipeline deps (poll/judge/… injectable for tests). */
  pipeline?: Omit<
    XPipelineRuntimeDeps,
    "log" | "now" | "batchSize" | "deadlineMs" | "executeDryRun"
  >;
  /** dry_run inspect (list pending effects without claim). */
  listPendingEffectsDryRun?: (
    limit: number,
  ) => Promise<ExecuteBatchAggregate>;
  probeInternalWork?: () => Promise<boolean>;
};

function defaultLog(line: string): void {
  console.log(line);
}

/**
 * One bounded production cycle for cron: validate-ready mode gate → lease → run → exit.
 */
export async function runXAgentProductionCycle(
  deps: XAgentProductionRuntimeDeps = {},
): Promise<XAgentProductionRunResult> {
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? Date.now;
  const started = now();
  const config = deps.config ?? resolveXAgentExecutionConfig();

  if (config.mode === "disabled") {
    const durationMs = now() - started;
    const summary = formatXAgentRunSummary({
      mode: "disabled",
      result: "noop",
      durationMs,
    });
    log(summary);
    return {
      ok: true,
      mode: "disabled",
      result: "noop",
      durationMs,
      summary,
      config,
    };
  }

  const leaseAttempt = await tryAcquireOpsRuntimeLease(
    {
      leaseKey: config.leaseKey,
      ttlSeconds: config.leaseTtlSeconds,
    },
    deps.lease,
  );

  if (!leaseAttempt.acquired) {
    const durationMs = now() - started;
    const summary = formatXAgentRunSummary({
      mode: config.mode,
      result: "lease_busy",
      durationMs,
    });
    log(summary);
    return {
      ok: true,
      mode: config.mode,
      result: "lease_busy",
      durationMs,
      summary,
      config,
    };
  }

  try {
    if (config.mode === "dry_run") {
      return await runDryRun(config, started, now, log, deps);
    }

    return await runLive(config, started, now, log, deps);
  } finally {
    try {
      await releaseOpsRuntimeLease(
        {
          leaseKey: leaseAttempt.leaseKey,
          holderId: leaseAttempt.holderId,
        },
        deps.lease,
      );
    } catch (error) {
      log(
        `[agent:run-x] lease_release_failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

async function runDryRun(
  config: XAgentExecutionConfig,
  started: number,
  now: () => number,
  log: (line: string) => void,
  deps: XAgentProductionRuntimeDeps,
): Promise<XAgentProductionRunResult> {
  const list =
    deps.listPendingEffectsDryRun ??
    ((limit: number) =>
      executePendingXPerceptionEffects({
        limit,
        dryRun: true,
        effectTypes: STAGE126_SPEECH_EFFECT_TYPES,
      }));

  const probe =
    deps.probeInternalWork ??
    (async () => (await probeXAgentInternalWork()).hasWork);

  const hasWork = await probe();
  const effects = await list(config.batchSize);
  const durationMs = now() - started;
  const summary = formatXAgentRunSummary({
    mode: "dry_run",
    result: "dry_run",
    durationMs,
    effects: effects.scanned,
    dryRunEffects: effects.dryRun,
  });
  log(summary);
  if (hasWork && effects.dryRun > 0) {
    for (const r of effects.results) {
      if (r.status !== "dry_run") continue;
      log(
        `[agent:run-x] would ${r.effectType ?? "?"} x_post_id=${r.xPostId ?? "?"}`,
      );
    }
  }

  return {
    ok: true,
    mode: "dry_run",
    result: "dry_run",
    durationMs,
    summary,
    config,
    pipeline: {
      ok: true,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(now()).toISOString(),
      durationMs,
      stoppedAtStage: null,
      budgetExhausted: false,
      skippedDueToNoWork: !hasWork && effects.scanned === 0,
      stages: [],
      execute: effects,
    },
  };
}

async function runLive(
  config: XAgentExecutionConfig,
  started: number,
  now: () => number,
  log: (line: string) => void,
  deps: XAgentProductionRuntimeDeps,
): Promise<XAgentProductionRunResult> {
  const deadlineMs = started + config.maxRuntimeSeconds * 1000;
  const probe =
    deps.probeInternalWork ??
    (async () => (await probeXAgentInternalWork()).hasWork);

  const pipeline = await runXAgentPipeline({
    ...deps.pipeline,
    log,
    now,
    batchSize: config.batchSize,
    deadlineMs,
    executeDryRun: false,
    quiet: true,
    hasInternalWork: probe,
  });

  const durationMs = now() - started;

  let resultCode: XAgentRunSummaryResultCode = "ok";
  if (!pipeline.ok) {
    resultCode = "failed";
  } else if (pipeline.budgetExhausted) {
    resultCode = "budget";
  } else if (pipeline.skippedDueToNoWork) {
    resultCode = "no_work";
  }

  const summary = formatXAgentRunSummary({
    mode: "live",
    result: resultCode,
    durationMs,
    pipeline,
  });
  log(summary);

  return {
    ok: pipeline.ok,
    mode: "live",
    result: resultCode,
    durationMs,
    summary,
    pipeline,
    config,
  };
}
