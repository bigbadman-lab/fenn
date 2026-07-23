import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatAccessScope,
  formatBoardIndex,
  formatCategoryLabel,
  formatDeedBoardDate,
  formatDeedReward,
  formatEvidenceDetail,
  formatEvidenceSummary,
  formatRepeatability,
} from "./format";
import type { DeedEvidenceRequirements } from "./types";

const sampleEvidence: DeedEvidenceRequirements = {
  text: { allowed: true, required: true },
  url: { allowed: true, required: false },
  image: { allowed: false, required: false },
  other: { allowed: false, required: false },
};

describe("deed format helpers", () => {
  it("formats board indexes as zero-padded visuals", () => {
    assert.equal(formatBoardIndex(0), "01");
    assert.equal(formatBoardIndex(9), "10");
    assert.equal(formatBoardIndex(-1), "??");
  });

  it("formats rewards from domain union", () => {
    assert.equal(formatDeedReward({ type: "fixed", amount: 25 }), "25 LEAF");
    assert.equal(
      formatDeedReward({ type: "range", min: 10, max: 30 }),
      "10—30 LEAF",
    );
    assert.equal(formatDeedReward({ type: "none" }), "NO LEAF");
  });

  it("formats evidence summaries", () => {
    assert.equal(formatEvidenceSummary(sampleEvidence), "text + url");
    assert.equal(
      formatEvidenceDetail(sampleEvidence),
      "text required / url optional",
    );
  });

  it("formats UTC board dates deterministically", () => {
    assert.equal(
      formatDeedBoardDate("2026-07-31T23:15:00.000Z"),
      "31 JUL 2026",
    );
    assert.equal(formatDeedBoardDate(null), null);
    assert.equal(formatDeedBoardDate("not-a-date"), null);
  });

  it("formats repeatability, scope, and category", () => {
    assert.equal(formatRepeatability(false), "ONE COMPLETION");
    assert.equal(formatRepeatability(true), "REPEATABLE");
    assert.equal(formatAccessScope("road"), "ROAD");
    assert.equal(formatAccessScope("greenwood"), "GREENWOOD");
    assert.equal(formatCategoryLabel(" find "), "FIND");
    assert.equal(formatCategoryLabel("  "), null);
  });
});
