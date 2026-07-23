import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapDeedModerationRpcError } from "./moderation-rpc-errors";

describe("mapDeedModerationRpcError", () => {
  it("maps submission not found", () => {
    const err = mapDeedModerationRpcError(
      "FENN_SUBMISSION_NOT_FOUND: submission missing",
    );
    assert.equal(err.code, "submission_not_found");
    assert.equal(err.status, 404);
  });

  it("maps already reviewed", () => {
    const err = mapDeedModerationRpcError(
      "FENN_SUBMISSION_ALREADY_REVIEWED: submission is rejected",
    );
    assert.equal(err.code, "submission_already_reviewed");
    assert.equal(err.status, 409);
  });

  it("maps completion cap", () => {
    const err = mapDeedModerationRpcError(
      "FENN_COMPLETION_CAP_REACHED: deed has no remaining completions",
    );
    assert.equal(err.code, "completion_cap_reached");
    assert.equal(err.status, 409);
  });

  it("maps invalid reward and review note", () => {
    assert.equal(
      mapDeedModerationRpcError("FENN_INVALID_REWARD: amount outside deed range")
        .code,
      "invalid_reward",
    );
    assert.equal(
      mapDeedModerationRpcError("FENN_INVALID_REVIEW_NOTE: review note required")
        .code,
      "invalid_review_note",
    );
  });

  it("maps ledger conflict and malformed reward config", () => {
    assert.equal(
      mapDeedModerationRpcError("FENN_LEDGER_CONFLICT: ledger profile mismatch")
        .code,
      "ledger_conflict",
    );
    assert.equal(
      mapDeedModerationRpcError(
        "FENN_INVALID_DEED_REWARD_CONFIG: malformed reward columns",
      ).code,
      "invalid_deed_reward_config",
    );
  });

  it("falls back for unknown errors", () => {
    const err = mapDeedModerationRpcError("something else");
    assert.equal(err.code, "rpc_failed");
    assert.equal(err.status, 500);
  });
});
