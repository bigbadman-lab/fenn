import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatXAgentRunSummary } from "@/lib/ops/x-agent-summary";

describe("x-agent-summary", () => {
  it("formats disabled noop without secrets", () => {
    const line = formatXAgentRunSummary({
      mode: "disabled",
      result: "noop",
      durationMs: 12,
    });
    assert.equal(line, "mode=disabled result=noop duration=12ms");
    assert.doesNotMatch(line, /token|secret|Bearer/i);
  });

  it("formats no_work and live counters with policy outcomes", () => {
    assert.match(
      formatXAgentRunSummary({
        mode: "live",
        result: "no_work",
        durationMs: 221,
      }),
      /mode=live result=no_work duration=221ms/,
    );
    assert.match(
      formatXAgentRunSummary({
        mode: "live",
        result: "ok",
        durationMs: 842,
        perceptions: 2,
        judgements: 2,
        effects: 1,
        posted: 1,
        wall: 0,
        policyOutcomes: { reply_only: 1, blocked: 1 },
      }),
      /mode=live result=ok duration=842ms perceptions=2 judgements=2 effects=1 posted=1 wall=0 outcomes=reply_only=1,blocked=1/,
    );
  });

  it("formats failed runs with stopped stage and safe error fragment", () => {
    const line = formatXAgentRunSummary({
      mode: "live",
      result: "failed",
      durationMs: 3087,
      perceptions: 0,
      judgements: 0,
      pipeline: {
        ok: false,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:03.000Z",
        durationMs: 3087,
        stoppedAtStage: "EXECUTE",
        budgetExhausted: false,
        skippedDueToNoWork: false,
        stages: [
          {
            stage: "EXECUTE",
            ok: false,
            hardFailed: true,
            durationMs: 400,
            errorMessage: "oauth_refresh_failed: invalid_grant",
          },
        ],
      },
    });
    assert.match(line, /result=failed/);
    assert.match(line, /stage=EXECUTE/);
    assert.match(line, /error=oauth_refresh_failed: invalid_grant/);
    assert.doesNotMatch(line, /token|secret|Bearer/i);
  });
});
