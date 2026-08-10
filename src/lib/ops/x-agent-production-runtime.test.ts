import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveXAgentExecutionConfig } from "@/lib/ops/x-agent-execution-config";
import { runXAgentProductionCycle } from "@/lib/ops/x-agent-production-runtime";
import { runXAgentPipeline } from "@/lib/ops/x-pipeline-runtime";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function leaseMock(sequence: boolean[]) {
  let i = 0;
  const holders = new Map<string, string>();
  return {
    admin: {
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        if (fn === "try_acquire_ops_runtime_lease") {
          const key = String(args?.p_lease_key ?? "");
          const holder = String(args?.p_holder_id ?? "");
          const ok = sequence[Math.min(i, sequence.length - 1)] ?? false;
          i += 1;
          if (ok) {
            holders.set(key, holder);
          }
          return { data: ok, error: null };
        }
        if (fn === "release_ops_runtime_lease") {
          const key = String(args?.p_lease_key ?? "");
          const holder = String(args?.p_holder_id ?? "");
          const current = holders.get(key);
          if (current === holder) {
            holders.delete(key);
            return { data: true, error: null };
          }
          return { data: false, error: null };
        }
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
      },
    },
  };
}

describe("x-agent-production-runtime", () => {
  it("disabled mode: env-valid entry exits noop without pipeline OpenAI/X/Wall", async () => {
    let pollCalls = 0;
    let judgeCalls = 0;
    let executeCalls = 0;
    const logs: string[] = [];

    const result = await runXAgentProductionCycle({
      config: resolveXAgentExecutionConfig({
        FENN_X_AGENT_EXECUTION_MODE: "disabled",
      } as unknown as NodeJS.ProcessEnv),
      log: (line) => logs.push(line),
      pipeline: {
        poll: async () => {
          pollCalls += 1;
          throw new Error("should not poll");
        },
        judge: async () => {
          judgeCalls += 1;
          throw new Error("should not judge");
        },
        execute: async () => {
          executeCalls += 1;
          throw new Error("should not execute");
        },
      },
      lease: leaseMock([true]),
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, "disabled");
    assert.equal(result.result, "noop");
    assert.equal(pollCalls + judgeCalls + executeCalls, 0);
    assert.match(logs.join("\n"), /mode=disabled result=noop/);
  });

  it("lease protection: second acquire busy exits without pipeline", async () => {
    let pollCalls = 0;
    const logs: string[] = [];
    const result = await runXAgentProductionCycle({
      config: {
        mode: "live",
        batchSize: 1,
        maxRuntimeSeconds: 50,
        leaseKey: "x_agent",
        leaseTtlSeconds: 65,
      },
      log: (line) => logs.push(line),
      lease: leaseMock([false]),
      pipeline: {
        poll: async () => {
          pollCalls += 1;
          throw new Error("should not poll when lease busy");
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.result, "lease_busy");
    assert.equal(pollCalls, 0);
    assert.match(logs.join("\n"), /result=lease_busy/);
  });

  it("dry_run inspects without claiming/mutating public surfaces", async () => {
    const logs: string[] = [];
    let dryListed = 0;
    const result = await runXAgentProductionCycle({
      config: {
        mode: "dry_run",
        batchSize: 1,
        maxRuntimeSeconds: 50,
        leaseKey: "x_agent",
        leaseTtlSeconds: 65,
      },
      log: (line) => logs.push(line),
      lease: leaseMock([true]),
      probeInternalWork: async () => true,
      listPendingEffectsDryRun: async () => {
        dryListed += 1;
        return {
          scanned: 1,
          completed: 0,
          failed: 0,
          dryRun: 1,
          results: [
            {
              status: "dry_run",
              effectType: "reply_on_x",
              xPostId: "99",
            },
          ],
        };
      },
      pipeline: {
        poll: async () => {
          throw new Error("dry_run must not poll X");
        },
        execute: async () => {
          throw new Error("dry_run must use dry list path");
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, "dry_run");
    assert.equal(result.result, "dry_run");
    assert.equal(dryListed, 1);
    assert.match(logs.join("\n"), /mode=dry_run/);
    assert.match(logs.join("\n"), /would reply_on_x/);
  });

  it("live no-work skips judge/execute (no OpenAI / no X write path)", async () => {
    let pollCalls = 0;
    let judgeCalls = 0;
    let executeCalls = 0;
    const logs: string[] = [];

    const result = await runXAgentProductionCycle({
      config: {
        mode: "live",
        batchSize: 1,
        maxRuntimeSeconds: 50,
        leaseKey: "x_agent",
        leaseTtlSeconds: 65,
      },
      log: (line) => logs.push(line),
      lease: leaseMock([true]),
      probeInternalWork: async () => false,
      pipeline: {
        poll: async () => {
          pollCalls += 1;
          return {
            fetched: 0,
            created: 0,
            existing: 0,
            failed: 0,
            pagesFetched: 0,
            sinceIdBefore: null,
            sinceIdAfter: null,
            fennXUserId: "1",
          };
        },
        judge: async () => {
          judgeCalls += 1;
          throw new Error("OpenAI path");
        },
        sight: async () => {
          throw new Error("sight");
        },
        authorize: async () => {
          throw new Error("authorize");
        },
        execute: async () => {
          executeCalls += 1;
          throw new Error("X write path");
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.result, "no_work");
    assert.equal(pollCalls, 1);
    assert.equal(judgeCalls, 0);
    assert.equal(executeCalls, 0);
    assert.match(logs.join("\n"), /result=no_work/);
  });

  function emptyPostPollStages() {
    return {
      judge: async () => ({
        scanned: 0,
        judged: 0,
        alreadyJudged: 0,
        failed: 0,
        empty: true,
        results: [],
      }),
      sight: async () => ({
        scanned: 0,
        finalized: 0,
        alreadyFinalized: 0,
        failed: 0,
        results: [],
      }),
      authorize: async () => ({
        scanned: 0,
        authorised: 0,
        alreadyAuthorised: 0,
        failed: 0,
        results: [],
      }),
    };
  }

  function liveTerminalEffectCycle(opts: {
    errorCode: string;
    logs: string[];
  }) {
    return runXAgentProductionCycle({
      config: {
        mode: "live",
        batchSize: 1,
        maxRuntimeSeconds: 50,
        leaseKey: "x_agent",
        leaseTtlSeconds: 65,
      },
      log: (line) => opts.logs.push(line),
      lease: leaseMock([true]),
      probeInternalWork: async () => true,
      pipeline: {
        poll: async () => ({
          fetched: 0,
          created: 0,
          existing: 0,
          failed: 0,
          pagesFetched: 0,
          sinceIdBefore: null,
          sinceIdAfter: null,
          fennXUserId: "1",
        }),
        ...emptyPostPollStages(),
        execute: async () => ({
          scanned: 1,
          completed: 0,
          failed: 1,
          dryRun: 0,
          results: [
            {
              status: "failed" as const,
              effectType: "reply_on_x",
              xPostId: "9004144782956841301",
              attemptCount: 1,
              failureClass: "terminal" as const,
              errorCode: opts.errorCode,
            },
          ],
        }),
      },
    });
  }

  it("live terminal x_reply_target_unavailable exits ok (cron exit 0)", async () => {
    const logs: string[] = [];
    const result = await liveTerminalEffectCycle({
      errorCode: "x_reply_target_unavailable",
      logs,
    });
    assert.equal(result.ok, true);
    assert.equal(result.result, "completed_with_terminal_effects");
    assert.doesNotMatch(logs.join("\n"), /hard_failure/);
    assert.match(logs.join("\n"), /completed_with_terminal_effects/);
    assert.match(logs.join("\n"), /x_reply_target_unavailable|class=terminal/);
    assert.match(logs.join("\n"), /reply_on_x/);
  });

  it("live terminal x_forbidden exits ok (cron exit 0)", async () => {
    const logs: string[] = [];
    const result = await liveTerminalEffectCycle({
      errorCode: "x_forbidden",
      logs,
    });
    assert.equal(result.ok, true);
    assert.equal(result.result, "completed_with_terminal_effects");
    assert.doesNotMatch(logs.join("\n"), /hard_failure/);
    assert.match(logs.join("\n"), /x_forbidden|class=terminal/);
  });

  it("live retryable execute failure still hard-fails the cycle", async () => {
    const logs: string[] = [];
    const result = await runXAgentProductionCycle({
      config: {
        mode: "live",
        batchSize: 1,
        maxRuntimeSeconds: 50,
        leaseKey: "x_agent",
        leaseTtlSeconds: 65,
      },
      log: (line) => logs.push(line),
      lease: leaseMock([true]),
      probeInternalWork: async () => true,
      pipeline: {
        poll: async () => ({
          fetched: 0,
          created: 0,
          existing: 0,
          failed: 0,
          pagesFetched: 0,
          sinceIdBefore: null,
          sinceIdAfter: null,
          fennXUserId: "1",
        }),
        ...emptyPostPollStages(),
        execute: async () => ({
          scanned: 1,
          completed: 0,
          failed: 1,
          dryRun: 0,
          results: [
            {
              status: "failed",
              effectType: "reply_on_x",
              failureClass: "retryable",
              errorCode: "x_rate_limited",
            },
          ],
        }),
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.result, "failed");
    assert.match(logs.join("\n"), /hard_failure/);
    assert.match(logs.join("\n"), /x_rate_limited/);
  });

  it("live infrastructure throw on execute exits failed", async () => {
    const logs: string[] = [];
    const result = await runXAgentProductionCycle({
      config: {
        mode: "live",
        batchSize: 1,
        maxRuntimeSeconds: 50,
        leaseKey: "x_agent",
        leaseTtlSeconds: 65,
      },
      log: (line) => logs.push(line),
      lease: leaseMock([true]),
      probeInternalWork: async () => true,
      pipeline: {
        poll: async () => ({
          fetched: 0,
          created: 0,
          existing: 0,
          failed: 0,
          pagesFetched: 0,
          sinceIdBefore: null,
          sinceIdAfter: null,
          fennXUserId: "1",
        }),
        ...emptyPostPollStages(),
        execute: async () => {
          throw new Error("claim failed: database unavailable");
        },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.result, "failed");
    assert.match(logs.join("\n"), /EXECUTE failed/);
    assert.match(logs.join("\n"), /database unavailable/);
  });

  it("live successful execute exits ok", async () => {
    const logs: string[] = [];
    const result = await runXAgentProductionCycle({
      config: {
        mode: "live",
        batchSize: 1,
        maxRuntimeSeconds: 50,
        leaseKey: "x_agent",
        leaseTtlSeconds: 65,
      },
      log: (line) => logs.push(line),
      lease: leaseMock([true]),
      probeInternalWork: async () => true,
      pipeline: {
        poll: async () => ({
          fetched: 0,
          created: 0,
          existing: 0,
          failed: 0,
          pagesFetched: 0,
          sinceIdBefore: null,
          sinceIdAfter: null,
          fennXUserId: "1",
        }),
        ...emptyPostPollStages(),
        execute: async () => ({
          scanned: 1,
          completed: 1,
          failed: 0,
          dryRun: 0,
          results: [
            {
              status: "completed",
              effectType: "reply_on_x",
              externalResultId: "99",
            },
          ],
        }),
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.result, "ok");
    assert.doesNotMatch(logs.join("\n"), /hard_failure/);
    assert.match(logs.join("\n"), /result=ok/);
  });

  it("live respects batch size on stages", async () => {
    const limits: number[] = [];
    await runXAgentProductionCycle({
      config: {
        mode: "live",
        batchSize: 1,
        maxRuntimeSeconds: 50,
        leaseKey: "x_agent",
        leaseTtlSeconds: 65,
      },
      log: () => {},
      lease: leaseMock([true]),
      probeInternalWork: async () => true,
      pipeline: {
        poll: async () => ({
          fetched: 1,
          created: 1,
          existing: 0,
          failed: 0,
          pagesFetched: 1,
          sinceIdBefore: null,
          sinceIdAfter: null,
          fennXUserId: "1",
        }),
        judge: async (limit) => {
          limits.push(limit ?? -1);
          return {
            scanned: 0,
            judged: 0,
            alreadyJudged: 0,
            failed: 0,
            empty: true,
            results: [],
          };
        },
        sight: async (limit) => {
          limits.push(limit ?? -1);
          return {
            scanned: 0,
            finalized: 0,
            alreadyFinalized: 0,
            failed: 0,
            results: [],
          };
        },
        authorize: async (limit) => {
          limits.push(limit ?? -1);
          return {
            scanned: 0,
            authorised: 0,
            alreadyAuthorised: 0,
            failed: 0,
            results: [],
          };
        },
        execute: async (limit) => {
          limits.push(limit ?? -1);
          return {
            scanned: 0,
            completed: 0,
            failed: 0,
            dryRun: 0,
            results: [],
          };
        },
      },
    });

    assert.deepEqual(limits, [1, 1, 1, 1]);
  });

  it("pipeline soft budget skips later stages after deadline", async () => {
    // started uses first now(); each stage pastDeadline check advances time.
    let t = 0;
    const order: string[] = [];
    const result = await runXAgentPipeline({
      now: () => {
        t += 1;
        return t * 10;
      },
      // After POLL (stage checks push t), later stages see now >= deadline.
      deadlineMs: 40,
      log: () => {},
      quiet: true,
      poll: async () => {
        order.push("POLL");
        return {
          fetched: 0,
          created: 1,
          existing: 0,
          failed: 0,
          pagesFetched: 1,
          sinceIdBefore: null,
          sinceIdAfter: null,
          fennXUserId: "1",
        };
      },
      judge: async () => {
        order.push("JUDGE");
        return {
          scanned: 0,
          judged: 0,
          alreadyJudged: 0,
          failed: 0,
          empty: true,
          results: [],
        };
      },
      sight: async () => {
        order.push("SIGHT");
        return {
          scanned: 0,
          finalized: 0,
          alreadyFinalized: 0,
          failed: 0,
          results: [],
        };
      },
      authorize: async () => {
        order.push("AUTHORIZE");
        return {
          scanned: 0,
          authorised: 0,
          alreadyAuthorised: 0,
          failed: 0,
          results: [],
        };
      },
      execute: async () => {
        order.push("EXECUTE");
        return {
          scanned: 0,
          completed: 0,
          failed: 0,
          dryRun: 0,
          results: [],
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.budgetExhausted, true);
    assert.ok(order.includes("POLL"));
    assert.ok(!order.includes("EXECUTE"));
  });

  it("render blueprint is a minute cron with agent:run-x", () => {
    const yaml = readFileSync(join(repo, "render.yaml"), "utf8");
    assert.match(yaml, /type:\s*cron/);
    assert.match(yaml, /name:\s*fenn-x-agent/);
    assert.match(yaml, /schedule:\s*"\* \* \* \* \*"/);
    assert.match(yaml, /buildCommand:\s*npm ci/);
    assert.match(yaml, /startCommand:\s*npm run agent:run-x/);
    assert.match(yaml, /FENN_X_AGENT_EXECUTION_MODE/);
    // Mode is Dashboard-owned (sync: false). value:disabled would reset live on every deploy.
    assert.match(
      yaml,
      /FENN_X_AGENT_EXECUTION_MODE[\s\S]*?sync:\s*false/,
    );
    assert.doesNotMatch(
      yaml,
      /FENN_X_AGENT_EXECUTION_MODE\s*\n\s*value:\s*disabled/,
    );
    assert.match(yaml, /FENN_X_AGENT_BATCH_SIZE/);
    assert.match(yaml, /FENN_X_AGENT_MAX_RUNTIME_SECONDS/);
    assert.doesNotMatch(yaml, /sk-live|Bearer /);
  });

  it("docs and migration exist for production lease", () => {
    const docs = readFileSync(join(repo, "docs/render-agent.md"), "utf8");
    assert.match(docs, /FENN_X_AGENT_EXECUTION_MODE/);
    assert.match(docs, /disabled/);
    assert.match(docs, /dry_run/);
    assert.match(docs, /Stage 5/);
    assert.match(docs, /OAuth/);

    const mig = readFileSync(
      join(
        repo,
        "supabase/migrations/20260804120000_46_ops_runtime_leases.sql",
      ),
      "utf8",
    );
    assert.match(mig, /try_acquire_ops_runtime_lease/);
    assert.match(mig, /release_ops_runtime_lease/);
    assert.match(mig, /probe_x_agent_internal_work/);
    assert.match(mig, /TO service_role/);
    assert.doesNotMatch(mig, /TO anon/);
  });
});
