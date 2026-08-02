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
  stages: XPipelineStageResult[];
  poll?: XPollAggregate;
  judge?: JudgeBatchAggregate;
  sight?: SightBatchAggregate;
  authorize?: AuthorizeBatchAggregate;
  execute?: ExecuteBatchAggregate;
};

export type XPipelineRuntimeDeps = {
  poll?: () => Promise<XPollAggregate>;
  judge?: () => Promise<JudgeBatchAggregate>;
  sight?: () => Promise<SightBatchAggregate>;
  authorize?: () => Promise<AuthorizeBatchAggregate>;
  execute?: () => Promise<ExecuteBatchAggregate>;
  log?: (line: string) => void;
  now?: () => number;
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

/** Mirrors scripts/agent-execute-x.ts hard-fail exit condition. */
export function executeStageHardFailed(result: ExecuteBatchAggregate): boolean {
  return result.failed > 0 && result.completed === 0 && result.dryRun === 0;
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

  const poll = deps.poll ?? (() => pollXMentions());
  const judge = deps.judge ?? (() => judgePendingXPerceptions());
  const sight =
    deps.sight ?? (() => finalizePendingXPerceptionsWithLiveState({}, {}));
  const authorize = deps.authorize ?? (() => authorizePendingXPerceptions());
  const execute = deps.execute ?? (() => executePendingXPerceptionEffects());

  log("[agent:run-x] START");

  let stoppedAtStage: XPipelineStageName | null = null;
  let ok = true;
  // Bag avoids TDZ when finish() runs after an early stage stop.
  const stageResults: {
    poll?: Awaited<ReturnType<typeof poll>>;
    judge?: Awaited<ReturnType<typeof judge>>;
    sight?: Awaited<ReturnType<typeof sight>>;
    authorize?: Awaited<ReturnType<typeof authorize>>;
    execute?: Awaited<ReturnType<typeof execute>>;
  } = {};

  const runStage = async <T>(
    stage: XPipelineStageName,
    fn: () => Promise<T>,
    report: (result: T) => string,
    hardFailed: (result: T) => boolean,
  ): Promise<T | null> => {
    log(`[agent:run-x] ${stage}`);
    const t0 = now();
    try {
      const result = await fn();
      const durationMs = now() - t0;
      log(report(result));
      const failed = hardFailed(result);
      stages.push({
        stage,
        ok: !failed,
        hardFailed: failed,
        durationMs,
      });
      log(`[agent:run-x] ${stage} done (${durationMs}ms)`);
      if (failed) {
        ok = false;
        stoppedAtStage = stage;
        log(`[agent:run-x] STOP after ${stage} (hard failure)`);
        return null;
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
      log(`[agent:run-x] STOP after ${stage} (fatal error)`);
      return null;
    }
  };

  stageResults.poll =
    (await runStage("POLL", poll, formatXPollReport, pollStageHardFailed)) ??
    undefined;
  if (stoppedAtStage) {
    return finish();
  }

  stageResults.judge =
    (await runStage(
      "JUDGE",
      judge,
      formatJudgeBatchReport,
      judgeStageHardFailed,
    )) ?? undefined;
  if (stoppedAtStage) {
    return finish();
  }

  stageResults.sight =
    (await runStage(
      "SIGHT",
      sight,
      formatSightBatchReport,
      sightStageHardFailed,
    )) ?? undefined;
  if (stoppedAtStage) {
    return finish();
  }

  stageResults.authorize =
    (await runStage(
      "AUTHORIZE",
      authorize,
      formatAuthorizeBatchReport,
      authorizeStageHardFailed,
    )) ?? undefined;
  if (stoppedAtStage) {
    return finish();
  }

  stageResults.execute =
    (await runStage(
      "EXECUTE",
      execute,
      formatExecuteBatchReport,
      executeStageHardFailed,
    )) ?? undefined;

  return finish();

  function finish(): XPipelineRunResult {
    const finished = now();
    const finishedAt = new Date(finished).toISOString();
    const durationMs = finished - started;
    if (ok) {
      log(`[agent:run-x] COMPLETE (${durationMs}ms)`);
    } else {
      log(
        `[agent:run-x] COMPLETE with failure` +
          (stoppedAtStage ? ` at ${stoppedAtStage}` : "") +
          ` (${durationMs}ms)`,
      );
    }
    return {
      ok,
      startedAt,
      finishedAt,
      durationMs,
      stoppedAtStage,
      stages,
      poll: stageResults.poll,
      judge: stageResults.judge,
      sight: stageResults.sight,
      authorize: stageResults.authorize,
      execute: stageResults.execute,
    };
  }
}
