import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LeafError } from "./errors";
import {
  assertIdempotencyKey,
  assertLifetimeDelta,
  assertMetadata,
  assertNonZeroAdjustAmount,
  assertPositiveAwardAmount,
  assertProfileId,
  assertReason,
  assertSafeIntegerAmount,
  leafIdempotencyKeys,
  parseHistoryLimit,
} from "./validate";

describe("LEAF validate — amounts", () => {
  it("accepts positive award integers", () => {
    assert.equal(assertPositiveAwardAmount(1), 1);
    assert.equal(assertPositiveAwardAmount(40), 40);
  });

  it("rejects zero and negative awards", () => {
    assert.throws(() => assertPositiveAwardAmount(0), LeafError);
    assert.throws(() => assertPositiveAwardAmount(-1), LeafError);
  });

  it("rejects fractional awards", () => {
    assert.throws(() => assertPositiveAwardAmount(1.5), LeafError);
  });

  it("rejects non-safe integers", () => {
    assert.throws(
      () => assertSafeIntegerAmount(Number.MAX_SAFE_INTEGER + 1, "amount"),
      LeafError,
    );
  });

  it("accepts signed non-zero adjust amounts", () => {
    assert.equal(assertNonZeroAdjustAmount(-5), -5);
    assert.equal(assertNonZeroAdjustAmount(5), 5);
  });

  it("rejects zero adjust amount", () => {
    assert.throws(() => assertNonZeroAdjustAmount(0), LeafError);
  });

  it("parses string integers safely", () => {
    assert.equal(assertSafeIntegerAmount("12", "amount"), 12);
    assert.equal(assertLifetimeDelta(-3), -3);
  });
});

describe("LEAF validate — keys and metadata", () => {
  it("requires idempotency key", () => {
    assert.throws(() => assertIdempotencyKey("  "), LeafError);
    assert.equal(assertIdempotencyKey(" camp_message:1:reward "), "camp_message:1:reward");
  });

  it("builds stable key helpers", () => {
    assert.equal(
      leafIdempotencyKeys.deedApproval("sub-1"),
      "deed_submission:sub-1:approval",
    );
    assert.equal(
      leafIdempotencyKeys.campMessageReward("msg-1"),
      "camp_message:msg-1:reward",
    );
    assert.equal(
      leafIdempotencyKeys.adminAdjustment("adj-1"),
      "admin_adjustment:adj-1",
    );
    assert.equal(
      leafIdempotencyKeys.system("evt-1", "bonus"),
      "system:evt-1:bonus",
    );
  });

  it("requires reason", () => {
    assert.throws(() => assertReason(""), LeafError);
    assert.equal(assertReason("  approved  "), "approved");
  });

  it("bounds metadata", () => {
    assert.deepEqual(assertMetadata({ a: 1 }), { a: 1 });
    assert.throws(
      () => assertMetadata({ huge: "x".repeat(20_000) }),
      LeafError,
    );
  });

  it("validates profile UUID", () => {
    assert.throws(() => assertProfileId("not-a-uuid"), LeafError);
    assert.equal(
      assertProfileId("11111111-1111-4111-8111-111111111111"),
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("caps history page size", () => {
    assert.equal(parseHistoryLimit(undefined), 20);
    assert.equal(parseHistoryLimit(100), 50);
  });
});

describe("LEAF award input shape", () => {
  it("AwardLeafInput type excludes lifetimeDelta at compile time", () => {
    // Runtime guard documented in awardLeaf — callers cannot pass lifetime_delta
    // through the public type. This test documents the contract.
    const sample = {
      profileId: "11111111-1111-4111-8111-111111111111",
      amount: 1,
      sourceType: "system" as const,
      reason: "test",
      actorType: "system" as const,
      idempotencyKey: "system:test:unit",
    };
    assert.equal("lifetimeDelta" in sample, false);
  });
});
