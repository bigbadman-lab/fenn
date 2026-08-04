import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FENN_X_AGENT_DEFAULT_BATCH_SIZE,
  FENN_X_AGENT_DEFAULT_MAX_RUNTIME_SECONDS,
  parseXAgentExecutionMode,
  resolveXAgentExecutionConfig,
} from "@/lib/ops/x-agent-execution-config";

describe("x-agent-execution-config", () => {
  it("defaults mode to disabled when missing, blank, or invalid", () => {
    assert.equal(parseXAgentExecutionMode(undefined), "disabled");
    assert.equal(parseXAgentExecutionMode(""), "disabled");
    assert.equal(parseXAgentExecutionMode("   "), "disabled");
    assert.equal(parseXAgentExecutionMode("LIVE"), "live");
    assert.equal(parseXAgentExecutionMode("dry_run"), "dry_run");
    assert.equal(parseXAgentExecutionMode("production"), "disabled");
    assert.equal(parseXAgentExecutionMode("true"), "disabled");
  });

  it("never resolves invalid values to live", () => {
    const cfg = resolveXAgentExecutionConfig({
      FENN_X_AGENT_EXECUTION_MODE: "enabled",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(cfg.mode, "disabled");
  });

  it("uses conservative batch and runtime defaults", () => {
    const cfg = resolveXAgentExecutionConfig({} as unknown as NodeJS.ProcessEnv);
    assert.equal(cfg.mode, "disabled");
    assert.equal(cfg.batchSize, FENN_X_AGENT_DEFAULT_BATCH_SIZE);
    assert.equal(
      cfg.maxRuntimeSeconds,
      FENN_X_AGENT_DEFAULT_MAX_RUNTIME_SECONDS,
    );
    assert.equal(cfg.batchSize, 1);
    assert.equal(cfg.maxRuntimeSeconds, 50);
    assert.ok(cfg.leaseTtlSeconds > cfg.maxRuntimeSeconds);
  });

  it("clamps batch size to a safe max", () => {
    const cfg = resolveXAgentExecutionConfig({
      FENN_X_AGENT_BATCH_SIZE: "99",
      FENN_X_AGENT_MAX_RUNTIME_SECONDS: "30",
      FENN_X_AGENT_EXECUTION_MODE: "live",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(cfg.mode, "live");
    assert.equal(cfg.batchSize, 5);
    assert.equal(cfg.maxRuntimeSeconds, 30);
    assert.equal(cfg.leaseTtlSeconds, 45);
  });
});
