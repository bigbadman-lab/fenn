import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  toPublicCommonsAllocationDelta,
  toPublicCommonsCommitment,
} from "./dto";
import { CommonsError } from "./errors";
import { exactNumericString } from "./numeric";

const here = dirname(fileURLToPath(import.meta.url));

describe("exactNumericString", () => {
  it("preserves exact decimal strings", () => {
    assert.equal(exactNumericString("100.50", "amount"), "100.50");
    assert.equal(exactNumericString("-12.25", "delta"), "-12.25");
    assert.equal(
      exactNumericString("9007199254740993", "amount"),
      "9007199254740993",
    );
  });

  it("rejects unsafe JS number coercion", () => {
    assert.throws(
      () => exactNumericString(1.5, "amount"),
      (err: unknown) =>
        err instanceof CommonsError && err.code === "commons_malformed_amount",
    );
    assert.throws(
      () => exactNumericString(Number.MAX_SAFE_INTEGER + 2, "amount"),
      (err: unknown) =>
        err instanceof CommonsError && err.code === "commons_malformed_amount",
    );
  });
});

describe("Commons public DTOs", () => {
  it("maps commitment amount as exact string and strips notes/actors", () => {
    const pub = toPublicCommonsCommitment({
      asset_symbol: "ETH",
      amount: "42.000000000000000001",
      value_usd_manual: "100",
      notes: "internal",
      updated_by_actor_id: "admin:1",
    });
    assert.deepEqual(pub, {
      assetSymbol: "ETH",
      amount: "42.000000000000000001",
      valueUsdManual: "100",
    });
    assert.equal("notes" in pub, false);
    assert.equal("updated_by_actor_id" in pub, false);
  });

  it("preserves signed allocation deltas as exact strings", () => {
    const pub = toPublicCommonsAllocationDelta({
      id: "d1",
      asset_symbol: "ETH",
      delta_amount: "-3.5",
      reason: "correction",
      related_contribution_id: null,
      actor_id: "admin:secret",
      created_at: "2026-07-01T00:00:00.000Z",
    });
    assert.equal(pub.deltaAmount, "-3.5");
    assert.equal("actor_id" in pub, false);
  });
});

describe("commons source safety", () => {
  it("does not import Stage 10 circulation modules", () => {
    for (const file of [
      "types.ts",
      "dto.ts",
      "commitments.ts",
      "index.ts",
      "snapshot.ts",
      "format.ts",
      "page-data.ts",
    ]) {
      const source = readFileSync(join(here, file), "utf8");
      assert.doesNotMatch(source, /from ["']@\/lib\/circulation/);
      assert.doesNotMatch(source, /circulation_recipients/);
      assert.doesNotMatch(source, /\.from\(["']circulations["']\)/);
    }
  });

  it("commitment query does not reconstruct from allocation deltas", () => {
    const source = readFileSync(join(here, "commitments.ts"), "utf8");
    assert.match(source, /from\(["']commons_commitments["']\)/);
    assert.doesNotMatch(source, /sum\(|reduce\(|delta_amount.*amount/i);
    const bodyStart = source.indexOf("export async function getCommonsCommitments");
    const bodyEnd = source.indexOf("export async function getCommonsAllocationHistory");
    assert.ok(bodyStart >= 0 && bodyEnd > bodyStart);
    const body = source.slice(bodyStart, bodyEnd);
    assert.doesNotMatch(body, /commons_allocations/);
  });
});
