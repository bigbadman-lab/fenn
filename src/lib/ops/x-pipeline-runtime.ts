/**
 * Stage 13.1 — one-shot X agent production orchestration.
 * Reuses Stage 12 stage functions unchanged. No workers, queues, or loops.
 */

import "server-only";

import {
  authorizePendingXPerceptions,
  formatAuthorizeBatchReport,
  type AuthorizeBatchAggregate,
} from "@/lib/agent/stage125-authorize";
import {
  executePendingXPerceptionEffects,
  formatExecuteBatchReport,
  type ExecuteBatchAggregate,
} from "@/lib/agent/stage126-execute";
import { STAGE126_SPEECH_EFFECT_TYPES } from "@/lib/agent/execute-config";
import {
  finalizePendingXPerceptionsWithLiveState,
  formatSightBatchReport,
  type SightBatchAggregate,
} from "@/lib/agent/stage124-sight";
import {
  formatJudgeBatchReport,
  judgePendingXPerceptions,
  type JudgeBatchAggregate,
} from "@/lib/agent/judge";
import { formatXPollReport, pollXMentions, type XPollAggregate } from "@/lib/x/poll";

export const X_PIPELINE_STAGES = [
  "POLL",
  "JUDGE",
  "SIGHT",
  "AUTHORIZE",
  "EXECUTE",
] as const;

export type XPipelineStageName = (typeof X_PIPELINE_STAGES)[number];

export type XPipelineStageResult = {
  stage: XPipelineStageName;
  ok: boolean;
  hardFailed: boolean;
  durationMs: number;
  errorMessage?: string;
};

export type XPipelineRunResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stoppedAtStage: XPipelineStageName | null;
  /** Soft stop: runtime budget exhausted before starting a stage. */
  budgetExhausted: boolean;
  /** Soft stop: no internal work after poll — later stages skipped. */
  skippedDueToNoWork: boolean;
  stages: XPipelineStageResult[];
  poll?: XPollAggregate;
  judge?: JudgeBatchAggregate;
  sight?: SightBatchAggregate;
  authorize?: AuthorizeBatchAggregate;
  execute?: ExecuteBatchAggregate;
};

export type XPipelineRuntimeDeps = {
  poll?: () => Promise<XPollAggregate>;
  judge?: (limit: number | undefined) => Promise<JudgeBatchAggregate>;
  sight?: (limit: number | undefined) => Promise<SightBatchAggregate>;
  authorize?: (limit: number | undefined) => Promise<AuthorizeBatchAggregate>;
  execute?: (
    limit: number | undefined,
    dryRun: boolean,
  ) => Promise<ExecuteBatchAggregate>;
  /** Cheap DB probe after poll; if false and poll created nothing, skip later stages. */
  hasInternalWork?: () => Promise<boolean>;
  log?: (line: string) => void;
  now?: () => number;
  /** Max items per post-poll stage. Defaults left to stage modules when unset. */
  batchSize?: number;
  /** Unix ms deadline; do not start a new stage after this. */
  deadlineMs?: number;
  /** Pass dry-run to execute stage (no claims / public mutations). */
  executeDryRun?: boolean;
  /** Quiet mode: only log stage failures + final line is for outer runtime. */
  quiet?: boolean;
};

/** Mirrors scripts/x-poll.ts hard-fail exit condition. */
export function pollStageHardFailed(result: XPollAggregate): boolean {
  return result.failed > 0 && result.created + result.existing === 0;
}

/** Mirrors scripts/agent-judge-x.ts hard-fail exit condition. */
export function judgeStageHardFailed(result: JudgeBatchAggregate): boolean {
  return result.failed > 0 && result.judged === 0;
}

/** Mirrors scripts/agent-sight-x.ts hard-fail exit condition. */
export function sightStageHardFailed(result: SightBatchAggregate): boolean {
  return result.failed > 0 && result.finalized === 0;
}

/** Mirrors scripts/agent-authorize-x.ts hard-fail exit condition. */
export function authorizeStageHardFailed(
  result: AuthorizeBatchAggregate,
): boolean {
  return result.failed > 0 && result.authorised === 0;
}

/**
 * Whether every failed execute result was a handled effect-level terminal
 * (e.g. x_reply_target_unavailable). Infrastructure / retryable / ambiguous
 * failures do not qualify.
 */
export function executeFailuresAreHandledTerminal(
  result: ExecuteBatchAggregate,
): boolean {
  if (result.failed <= 0) return false;
  const failed = result.results.filter((r) => r.status === "failed");
  if (failed.length === 0) return false;
  // Must account for full failed count when classes are present.
  if (failed.length < result.failed) return false;
  return failed.every((r) => r.failureClass === "terminal");
}

/**
 * Cron/CLI hard-fail: only when execution failed *without* a durable handled
 * completion, and not solely due to correctly persisted terminal effects.
 * Handled terminal outcomes (deleted/not-visible reply, x_forbidden) must not
 * page the production cron.
 */
export function executeStageHardFailed(result: ExecuteBatchAggregate): boolean {
  if (result.completed > 0 || result.dryRun > 0) return false;
  if (result.failed <= 0) return false;
  if (executeFailuresAreHandledTerminal(result)) return false;
  return true;
}

/**
 * Quiet production: surface handled terminal effects without hard_failure wording.
 */
export function executeCompletedWithTerminalEffects(
  result: ExecuteBatchAggregate,
): boolean {
  return (
    result.failed > 0 &&
    executeFailuresAreHandledTerminal(result) &&
    !executeStageHardFailed(result)
  );
}

function defaultLog(line: string): void {
  console.log(line);
}

/**
 * Sequential one-shot pipeline: poll → judge → sight → authorize → execute.
 * Stops on thrown errors or a stage hard-fail (same rules as individual CLIs).
 */
export async function runXAgentPipeline(
  deps: XPipelineRuntimeDeps = {},
): Promise<XPipelineRunResult> {
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? Date.now;
  const started = now();
  const startedAt = new Date(started).toISOString();
  const stages: XPipelineStageResult[] = [];
  const batchSize = deps.batchSize;
  const executeDryRun = deps.executeDryRun === true;
  const quiet = deps.quiet === true;

  const poll = deps.poll ?? (() => pollXMentions());
  const judge =
    deps.judge ??
    ((limit: number | undefined) =>
      judgePendingXPerceptions(
        limit !== undefined ? { limit } : {},
      ));
  const sight =
    deps.sight ??
    ((limit: number | undefined) =>
      finalizePendingXPerceptionsWithLiveState(
        limit !== undefined ? { limit } : {},
      ));
  const authorize =
    deps.authorize ??
    ((limit: number | undefined) =>
      authorizePendingXPerceptions(
        limit !== undefined ? { limit } : {},
      ));
  const execute =
    deps.execute ??
    ((limit: number | undefined, dryRun: boolean) =>
      executePendingXPerceptionEffects({
        ...(limit !== undefined ? { limit } : {}),
        dryRun,
        // P2A: production X Agent claims speech only (never transfer/burn).
        effectTypes: STAGE126_SPEECH_EFFECT_TYPES,
      }));

  if (!quiet) {
    log("[agent:run-x] START");
  }

  let stoppedAtStage: XPipelineStageName | null = null;
  let ok = true;
  let budgetExhausted = false;
  let skippedDueToNoWork = false;
  // Bag avoids TDZ when finish() runs after an early stage stop.
  const stageResults: {
    poll?: Awaited<ReturnType<typeof poll>>;
    judge?: Awaited<ReturnType<typeof judge>>;
    sight?: Awaited<ReturnType<typeof sight>>;
    authorize?: Awaited<ReturnType<typeof authorize>>;
    execute?: Awaited<ReturnType<typeof execute>>;
  } = {};

  const stageLimit = (): number | undefined => {
    if (batchSize !== undefined && Number.isFinite(batchSize) && batchSize >= 1) {
      return Math.floor(batchSize);
    }
    // Preserve prior stage defaults when production batch is not forced.
    return undefined;
  };

  const pastDeadline = (): boolean => {
    if (deps.deadlineMs === undefined) return false;
    return now() >= deps.deadlineMs;
  };

  const runStage = async <T>(
    stage: XPipelineStageName,
    fn: () => Promise<T>,
    report: (result: T) => string,
    hardFailed: (result: T) => boolean,
  ): Promise<T | null> => {
    if (pastDeadline()) {
      budgetExhausted = true;
      if (!quiet) {
        log(`[agent:run-x] BUDGET — skip ${stage}`);
      }
      return null;
    }

    if (!quiet) {
      log(`[agent:run-x] ${stage}`);
    }
    const t0 = now();
    try {
      const result = await fn();
      const durationMs = now() - t0;
      if (!quiet) {
        log(report(result));
      }
      const failed = hardFailed(result);
      stages.push({
        stage,
        ok: !failed,
        hardFailed: failed,
        durationMs,
      });
      if (failed) {
        // Keep stage aggregate for the production summary (quiet mode drops stage reports).
        ok = false;
        stoppedAtStage = stage;
        log(
          `[agent:run-x] ${stage} hard_failure (${durationMs}ms) — ${report(result)}`,
        );
        return result;
      }
      // Quiet production: log handled terminal effect outcomes without hard_failure / !ok.
      if (
        quiet &&
        stage === "EXECUTE" &&
        result &&
        typeof result === "object" &&
        "results" in result &&
        executeCompletedWithTerminalEffects(
          result as ExecuteBatchAggregate,
        )
      ) {
        log(
          `[agent:run-x] EXECUTE completed_with_terminal_effects (${durationMs}ms) — ${report(result)}`,
        );
      }
      if (!quiet) {
        log(`[agent:run-x] ${stage} done (${durationMs}ms)`);
      }
      return result;
    } catch (error) {
      const durationMs = now() - t0;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      stages.push({
        stage,
        ok: false,
        hardFailed: true,
        durationMs,
        errorMessage,
      });
      ok = false;
      stoppedAtStage = stage;
      log(`[agent:run-x] ${stage} failed (${durationMs}ms): ${errorMessage}`);
      if (!quiet) {
        log(`[agent:run-x] STOP after ${stage} (fatal error)`);
      }
      return null;
    }
  };

  stageResults.poll = await runStage(
    "POLL",
    poll,
    formatXPollReport,
    pollStageHardFailed,
  ).then((r) => r ?? undefined);
  if (stoppedAtStage) {
    return finish();
  }
  if (budgetExhausted) {
    return finish();
  }

  // After poll: if nothing new and no internal queue work, skip paid stages.
  const created = stageResults.poll?.created ?? 0;
  if (created === 0 && deps.hasInternalWork) {
    const hasWork = await deps.hasInternalWork();
    if (!hasWork) {
      skippedDueToNoWork = true;
      if (!quiet) {
        log("[agent:run-x] NO_WORK — skip JUDGE/SIGHT/AUTHORIZE/EXECUTE");
      }
      return finish();
    }
  }

  const limit = stageLimit();

  stageResults.judge = await runStage(
    "JUDGE",
    () => judge(limit),
    formatJudgeBatchReport,
    judgeStageHardFailed,
  ).then((r) => r ?? undefined);
  if (stoppedAtStage || budgetExhausted) {
    return finish();
  }

  stageResults.sight = await runStage(
    "SIGHT",
    () => sight(limit),
    formatSightBatchReport,
    sightStageHardFailed,
  ).then((r) => r ?? undefined);
  if (stoppedAtStage || budgetExhausted) {
    return finish();
  }

  stageResults.authorize = await runStage(
    "AUTHORIZE",
    () => authorize(limit),
    formatAuthorizeBatchReport,
    authorizeStageHardFailed,
  ).then((r) => r ?? undefined);
  if (stoppedAtStage || budgetExhausted) {
    return finish();
  }

  stageResults.execute = await runStage(
    "EXECUTE",
    () => execute(limit, executeDryRun),
    formatExecuteBatchReport,
    executeStageHardFailed,
  ).then((r) => r ?? undefined);

  return finish();

  function finish(): XPipelineRunResult {
    const finished = now();
    const finishedAt = new Date(finished).toISOString();
    const durationMs = finished - started;
    if (!quiet) {
      if (ok) {
        log(`[agent:run-x] COMPLETE (${durationMs}ms)`);
      } else {
        log(
          `[agent:run-x] COMPLETE with failure` +
            (stoppedAtStage ? ` at ${stoppedAtStage}` : "") +
            ` (${durationMs}ms)`,
        );
      }
    }
    return {
      ok,
      startedAt,
      finishedAt,
      durationMs,
      stoppedAtStage,
      budgetExhausted,
      skippedDueToNoWork,
      stages,
      poll: stageResults.poll,
      judge: stageResults.judge,
      sight: stageResults.sight,
      authorize: stageResults.authorize,
      execute: stageResults.execute,
    };
  }
}
