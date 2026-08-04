import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  authorizeStageHardFailed,
  executeStageHardFailed,
  judgeStageHardFailed,
  pollStageHardFailed,
  runXAgentPipeline,
  sightStageHardFailed,
} from "@/lib/ops/x-pipeline-runtime";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

describe("x-pipeline-runtime", () => {
  it("hard-fail predicates match individual CLI exit rules", () => {
    assert.equal(
      pollStageHardFailed({
        fetched: 1,
        created: 0,
        existing: 0,
        failed: 1,
        pagesFetched: 1,
        sinceIdBefore: null,
        sinceIdAfter: null,
        fennXUserId: "1",
      }),
      true,
    );
    assert.equal(
      pollStageHardFailed({
        fetched: 1,
        created: 1,
        existing: 0,
        failed: 1,
        pagesFetched: 1,
        sinceIdBefore: null,
        sinceIdAfter: null,
        fennXUserId: "1",
      }),
      false,
    );
    assert.equal(
      judgeStageHardFailed({
        scanned: 1,
        judged: 0,
        alreadyJudged: 0,
        failed: 1,
        empty: false,
        results: [],
      }),
      true,
    );
    assert.equal(
      sightStageHardFailed({
        scanned: 1,
        finalized: 0,
        alreadyFinalized: 0,
        failed: 1,
        results: [],
      }),
      true,
    );
    assert.equal(
      authorizeStageHardFailed({
        scanned: 1,
        authorised: 0,
        alreadyAuthorised: 0,
        failed: 1,
        results: [],
      }),
      true,
    );
    assert.equal(
      executeStageHardFailed({
        scanned: 1,
        completed: 0,
        failed: 1,
        dryRun: 0,
        results: [],
      }),
      true,
    );
  });

  it("runs stages in order and completes when all succeed", async () => {
    const order: string[] = [];
    const logs: string[] = [];
    let t = 1_000;

    const result = await runXAgentPipeline({
      now: () => {
        t += 10;
        return t;
      },
      log: (line) => logs.push(line),
      poll: async () => {
        order.push("POLL");
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

    assert.deepEqual(order, [
      "POLL",
      "JUDGE",
      "SIGHT",
      "AUTHORIZE",
      "EXECUTE",
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.stoppedAtStage, null);
    assert.equal(result.stages.length, 5);
    assert.match(logs.join("\n"), /\[agent:run-x\] START/);
    assert.match(logs.join("\n"), /\[agent:run-x\] COMPLETE/);
  });

  it("stops after a thrown fatal error and skips later stages", async () => {
    const order: string[] = [];
    const result = await runXAgentPipeline({
      log: () => {},
      poll: async () => {
        order.push("POLL");
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
        order.push("JUDGE");
        throw new Error("model unavailable");
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

    assert.deepEqual(order, ["POLL", "JUDGE"]);
    assert.equal(result.ok, false);
    assert.equal(result.stoppedAtStage, "JUDGE");
    assert.equal(result.stages.at(-1)?.errorMessage, "model unavailable");
  });

  it("stops after a stage hard-fail without running later stages", async () => {
    const order: string[] = [];
    const result = await runXAgentPipeline({
      log: () => {},
      poll: async () => {
        order.push("POLL");
        return {
          fetched: 2,
          created: 0,
          existing: 0,
          failed: 2,
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

    assert.deepEqual(order, ["POLL"]);
    assert.equal(result.ok, false);
    assert.equal(result.stoppedAtStage, "POLL");
  });

  it("package exposes agent:run-x without .env.local hardcoding", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
      engines?: { node?: string };
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["agent:run-x"] ?? "", /agent-run-x-pipeline/);
    assert.match(pkg.scripts["agent:run-x"] ?? "", /scripts\/load-env\.ts/);
    assert.doesNotMatch(pkg.scripts["agent:run-x"] ?? "", /--env-file=/);
    assert.match(pkg.engines?.node ?? "", /24/);
    assert.match(pkg.scripts.test, /src\/lib\/ops\/\*\*\/\*\.test\.ts/);
  });

  it("skips paid stages when poll creates nothing and internal probe is empty", async () => {
    const order: string[] = [];
    const result = await runXAgentPipeline({
      log: () => {},
      quiet: true,
      hasInternalWork: async () => false,
      poll: async () => {
        order.push("POLL");
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

    assert.deepEqual(order, ["POLL"]);
    assert.equal(result.skippedDueToNoWork, true);
    assert.equal(result.ok, true);
  });
});
