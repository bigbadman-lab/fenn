/**
 * Concise execution summaries for Render cron logs.
 * Never include tokens, secrets, prompts, or OAuth credentials.
 */

import type { FennXAgentExecutionMode } from "@/lib/ops/x-agent-execution-config";
import type { XPipelineRunResult } from "@/lib/ops/x-pipeline-runtime";

export type XAgentRunSummaryResultCode =
  | "noop"
  | "no_work"
  | "lease_busy"
  | "budget"
  | "ok"
  | "failed"
  | "dry_run";

export type XAgentRunSummaryInput = {
  mode: FennXAgentExecutionMode;
  result: XAgentRunSummaryResultCode;
  durationMs?: number;
  pipeline?: XPipelineRunResult;
  perceptions?: number;
  judgements?: number;
  effects?: number;
  posted?: number;
  wall?: number;
  dryRunEffects?: number;
};

function kv(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * One-line operator summary. Safe for minute-level cron logging.
 */
export function formatXAgentRunSummary(input: XAgentRunSummaryInput): string {
  const duration =
    input.durationMs !== undefined
      ? `duration=${Math.max(0, Math.round(input.durationMs))}ms`
      : null;

  if (input.mode === "disabled" || input.result === "noop") {
    return kv([`mode=${input.mode}`, "result=noop", duration]);
  }

  if (input.result === "lease_busy") {
    return kv([`mode=${input.mode}`, "result=lease_busy", duration]);
  }

  if (input.result === "no_work") {
    return kv([`mode=${input.mode}`, "result=no_work", duration]);
  }

  if (input.result === "budget") {
    return kv([`mode=${input.mode}`, "result=budget", duration]);
  }

  if (input.result === "dry_run") {
    return kv([
      `mode=${input.mode}`,
      "result=dry_run",
      duration,
      input.effects !== undefined ? `effects=${input.effects}` : null,
      input.dryRunEffects !== undefined
        ? `would_mutate=${input.dryRunEffects}`
        : null,
    ]);
  }

  const pipeline = input.pipeline;
  const perceptions =
    input.perceptions ??
    (pipeline?.poll
      ? pipeline.poll.created + pipeline.poll.existing
      : undefined);
  const judgements =
    input.judgements ??
    (pipeline?.judge ? pipeline.judge.judged : undefined);
  const effects =
    input.effects ??
    (pipeline?.execute ? pipeline.execute.scanned : undefined);
  const posted =
    input.posted ??
    (pipeline?.execute
      ? pipeline.execute.results.filter(
          (r) =>
            r.status === "completed" && r.effectType === "reply_on_x",
        ).length
      : undefined);
  const wall =
    input.wall ??
    (pipeline?.execute
      ? pipeline.execute.results.filter(
          (r) =>
            r.status === "completed" && r.effectType === "write_to_wall",
        ).length
      : undefined);

  return kv([
    `mode=${input.mode}`,
    `result=${input.result}`,
    duration,
    perceptions !== undefined ? `perceptions=${perceptions}` : null,
    judgements !== undefined ? `judgements=${judgements}` : null,
    effects !== undefined ? `effects=${effects}` : null,
    posted !== undefined ? `posted=${posted}` : null,
    wall !== undefined ? `wall=${wall}` : null,
  ]);
}
