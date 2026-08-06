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
});
