/**
 * Concise execution summaries for Render cron logs.
 * Never include tokens, secrets, prompts, or OAuth credentials.
 */

import type { FennXAgentExecutionMode } from "@/lib/ops/x-agent-execution-config";
import type { XPipelineRunResult } from "@/lib/ops/x-pipeline-runtime";
import type { Stage12PolicyOutcome } from "@/lib/agent/reply-guarantee-policy";
import {
  policyOutcomeFromAction,
  policyOutcomeFromEffectExecution,
} from "@/lib/agent/reply-guarantee-policy";

export type XAgentRunSummaryResultCode =
  | "noop"
  | "no_work"
  | "lease_busy"
  | "budget"
  | "ok"
  | "failed"
  | "dry_run"
  /** Eligible work finished with zero planned effects — not idle. */
  | "policy_invariant_violation";

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
  /** Aggregated policy outcomes seen this run (e.g. reply_only=2 wall_and_reply=1). */
  policyOutcomes?: Partial<Record<Stage12PolicyOutcome, number>>;
};

function kv(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Derive policy outcome counters from a pipeline execute stage when present.
 */
export function derivePolicyOutcomesFromPipeline(
  pipeline: XPipelineRunResult | undefined,
): Partial<Record<Stage12PolicyOutcome, number>> {
  if (!pipeline?.execute) return {};
  const counts: Partial<Record<Stage12PolicyOutcome, number>> = {};
  const results = pipeline.execute.results ?? [];

  // Per-effect classification is coarse; also fold authorize outcomes when present.
  for (const r of results) {
    if (r.status === "completed" && r.effectType === "reply_on_x") {
      counts.reply_only = (counts.reply_only ?? 0) + 1;
    }
    if (r.status === "completed" && r.effectType === "write_to_wall") {
      counts.wall_and_reply = (counts.wall_and_reply ?? 0) + 1;
    }
    if (r.status === "failed" && r.effectType === "reply_on_x") {
      counts.reply_failed = (counts.reply_failed ?? 0) + 1;
    }
    if (r.status === "failed" && r.effectType === "write_to_wall") {
      counts.wall_failed = (counts.wall_failed ?? 0) + 1;
    }
  }

  if (pipeline.authorize) {
    for (const a of pipeline.authorize.results ?? []) {
      if (a.status === "reply_generation_failed") {
        counts.reply_generation_failed =
          (counts.reply_generation_failed ?? 0) + 1;
        continue;
      }
      if (a.outcome === "no_action" || a.outcome === "denied") {
        counts.blocked = (counts.blocked ?? 0) + 1;
      }
      if (
        a.outcome === "permitted" &&
        (a.effectsCreated === 0 || a.effectsCreated === undefined)
      ) {
        counts.reply_generation_failed =
          (counts.reply_generation_failed ?? 0) + 1;
      }
      if (a.replyRecovery === "succeeded") {
        counts.reply_recovery_succeeded =
          (counts.reply_recovery_succeeded ?? 0) + 1;
      }
    }
  }

  return counts;
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

  // no_work only when poller found no eligible perceptions / internal work.
  if (input.result === "no_work") {
    return kv([`mode=${input.mode}`, "result=no_work", duration]);
  }

  if (input.result === "budget") {
    return kv([`mode=${input.mode}`, "result=budget", duration]);
  }

  if (input.result === "policy_invariant_violation") {
    return kv([
      `mode=${input.mode}`,
      "result=policy_invariant_violation",
      duration,
      "note=eligible_work_zero_effects",
    ]);
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

  const outcomes =
    input.policyOutcomes ?? derivePolicyOutcomesFromPipeline(pipeline);
  const outcomeParts = (
    [
      "reply_only",
      "wall_and_reply",
      "blocked",
      "reply_failed",
      "wall_failed",
      "partially_completed",
      "reply_generation_failed",
      "reply_pending_retry",
      "reply_recovery_succeeded",
      "reply_recovery_attempted",
    ] as const
  )
    .filter((k) => (outcomes[k] ?? 0) > 0)
    .map((k) => `${k}=${outcomes[k]}`);

  // Pipeline authorize may surface reply_generation_failed counts.
  const authGenFailed =
    pipeline?.authorize?.replyGenerationFailed !== undefined &&
    pipeline.authorize.replyGenerationFailed > 0
      ? `reply_generation_failed=${pipeline.authorize.replyGenerationFailed}`
      : null;

  return kv([
    `mode=${input.mode}`,
    `result=${input.result}`,
    duration,
    perceptions !== undefined ? `perceptions=${perceptions}` : null,
    judgements !== undefined ? `judgements=${judgements}` : null,
    effects !== undefined ? `effects=${effects}` : null,
    posted !== undefined ? `posted=${posted}` : null,
    wall !== undefined ? `wall=${wall}` : null,
    outcomeParts.length > 0 ? `outcomes=${outcomeParts.join(",")}` : null,
    authGenFailed,
  ]);
}

export { policyOutcomeFromAction, policyOutcomeFromEffectExecution };
