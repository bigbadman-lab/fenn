import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PUBLIC_COMMONS_ALLOCATION_HISTORY_LIMIT } from "./commitments";
import { CommonsError } from "./errors";
import { getPublicCommonsSnapshot } from "./snapshot";
import type {
  PublicCommonsAllocationDelta,
  PublicCommonsCommitment,
} from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const OBSERVED = new Date("2026-07-23T15:00:00.000Z");

function commitment(
  overrides: Partial<PublicCommonsCommitment> = {},
): PublicCommonsCommitment {
  return {
    assetSymbol: "ETH",
    amount: "1000.123456789",
    valueUsdManual: null,
    ...overrides,
  };
}

function delta(
  overrides: Partial<PublicCommonsAllocationDelta> = {},
): PublicCommonsAllocationDelta {
  return {
    id: "d1",
    assetSymbol: "ETH",
    deltaAmount: "25",
    reason: "initial commitment",
    relatedContributionId: null,
    createdAt: "2026-07-23T10:00:00.000Z",
    ...overrides,
  };
}

describe("getPublicCommonsSnapshot", () => {
  it("returns ready with empty commitments (not unavailable)", async () => {
    const snapshot = await getPublicCommonsSnapshot({
      getCommitments: async () => [],
      getAllocationHistory: async () => [],
      now: () => OBSERVED,
    });
    assert.deepEqual(snapshot, {
      state: "ready",
      observedAt: OBSERVED.toISOString(),
      commitments: [],
      allocationHistory: { state: "available", items: [] },
    });
  });

  it("preserves exact commitment amount strings", async () => {
    const snapshot = await getPublicCommonsSnapshot({
      getCommitments: async () => [
        commitment({ amount: "1000.123456789" }),
      ],
      getAllocationHistory: async () => [],
      now: () => OBSERVED,
    });
    assert.equal(snapshot.state, "ready");
    assert.equal(snapshot.commitments[0].amount, "1000.123456789");
  });

  it("preserves known zero commitment", async () => {
    const snapshot = await getPublicCommonsSnapshot({
      getCommitments: async () => [commitment({ amount: "0" })],
      getAllocationHistory: async () => [],
      now: () => OBSERVED,
    });
    assert.equal(snapshot.commitments[0].amount, "0");
    assert.equal(snapshot.commitments.length, 1);
  });

  it("keeps multiple commitments in provided deterministic order", async () => {
    const snapshot = await getPublicCommonsSnapshot({
      getCommitments: async () => [
        commitment({ assetSymbol: "ETH", amount: "1" }),
        commitment({ assetSymbol: "USDC", amount: "2" }),
      ],
      getAllocationHistory: async () => [],
      now: () => OBSERVED,
    });
    assert.deepEqual(
      snapshot.commitments.map((c) => c.assetSymbol),
      ["ETH", "USDC"],
    );
  });

  it("preserves positive and negative allocation deltas exactly", async () => {
    const snapshot = await getPublicCommonsSnapshot({
      getCommitments: async () => [commitment()],
      getAllocationHistory: async () => [
        delta({ id: "p", deltaAmount: "25", createdAt: "2026-07-23T12:00:00.000Z" }),
        delta({ id: "n", deltaAmount: "-10", createdAt: "2026-07-23T11:00:00.000Z" }),
      ],
      now: () => OBSERVED,
    });
    assert.equal(snapshot.allocationHistory.state, "available");
    if (snapshot.allocationHistory.state !== "available") return;
    assert.equal(snapshot.allocationHistory.items[0].deltaAmount, "25");
    assert.equal(snapshot.allocationHistory.items[1].deltaAmount, "-10");
  });

  it("preserves huge numerics beyond MAX_SAFE_INTEGER", async () => {
    const huge = "9007199254740993";
    const snapshot = await getPublicCommonsSnapshot({
      getCommitments: async () => [commitment({ amount: huge })],
      getAllocationHistory: async () => [
        delta({ deltaAmount: `-${huge}` }),
      ],
      now: () => OBSERVED,
    });
    assert.equal(snapshot.commitments[0].amount, huge);
    assert.equal(snapshot.allocationHistory.state, "available");
    if (snapshot.allocationHistory.state !== "available") return;
    assert.equal(snapshot.allocationHistory.items[0].deltaAmount, `-${huge}`);
  });

  it("fails closed when commitment query fails (not empty)", async () => {
    await assert.rejects(
      () =>
        getPublicCommonsSnapshot({
          getCommitments: async () => {
            throw new CommonsError(
              "commons_read_failed",
              "Failed to load Commons commitments",
              500,
            );
          },
          getAllocationHistory: async () => [],
          now: () => OBSERVED,
        }),
      (err: unknown) =>
        err instanceof CommonsError && err.code === "commons_read_failed",
    );
  });

  it("keeps commitments when allocation history fails", async () => {
    const snapshot = await getPublicCommonsSnapshot({
      getCommitments: async () => [
        commitment({ amount: "42" }),
      ],
      getAllocationHistory: async () => {
        throw new CommonsError(
          "commons_read_failed",
          "Failed to load Commons allocation history",
          500,
        );
      },
      now: () => OBSERVED,
    });
    assert.equal(snapshot.state, "ready");
    assert.equal(snapshot.commitments[0].amount, "42");
    assert.deepEqual(snapshot.allocationHistory, { state: "unavailable" });
    assert.equal("items" in snapshot.allocationHistory, false);
  });

  it("does not reconstruct current commitment from deltas", async () => {
    const snapshot = await getPublicCommonsSnapshot({
      getCommitments: async () => [commitment({ amount: "100" })],
      getAllocationHistory: async () => [
        delta({ deltaAmount: "999" }),
        delta({ id: "d2", deltaAmount: "-50" }),
      ],
      now: () => OBSERVED,
    });
    // Authoritative amount stays 100 even if deltas disagree.
    assert.equal(snapshot.commitments[0].amount, "100");
    assert.equal(snapshot.allocationHistory.state, "available");
    if (snapshot.allocationHistory.state !== "available") return;
    const sumAttempt = snapshot.allocationHistory.items.reduce(
      (acc, row) => acc + Number(row.deltaAmount),
      0,
    );
    assert.notEqual(String(sumAttempt), snapshot.commitments[0].amount);
  });

  it("public DTO omits actor and notes fields", async () => {
    const snapshot = await getPublicCommonsSnapshot({
      getCommitments: async () => [
        commitment({ valueUsdManual: "10.00" }),
      ],
      getAllocationHistory: async () => [delta()],
      now: () => OBSERVED,
    });
    const json = JSON.stringify(snapshot);
    assert.doesNotMatch(json, /actor_id|updated_by_actor_id|"notes"/);
  });
});

describe("Commons allocation history limit", () => {
  it("exports explicit public MVP limit of 50", () => {
    assert.equal(PUBLIC_COMMONS_ALLOCATION_HISTORY_LIMIT, 50);
    const source = readFileSync(join(here, "commitments.ts"), "utf8");
    assert.match(source, /PUBLIC_COMMONS_ALLOCATION_HISTORY_LIMIT/);
    assert.match(source, /\.order\(["']created_at["'],\s*\{\s*ascending:\s*false/);
    assert.match(source, /\.limit\(/);
  });
});

describe("GET /api/commons route", () => {
  it("is public with no-store / force-dynamic", () => {
    const source = readFileSync(
      join(here, "../../app/api/commons/route.ts"),
      "utf8",
    );
    assert.match(source, /getPublicCommonsSnapshot/);
    assert.doesNotMatch(source, /getVerifiedPrivyUser|from ["']@\/lib\/auth/);
    assert.match(source, /No Privy authentication/);
    assert.match(source, /force-dynamic/);
    assert.match(source, /no-store/);
  });

  it("returns ready empty as 200", async () => {
    const { handleCommonsGet } = await import("../../app/api/commons/route");
    const response = await handleCommonsGet(async () => ({
      state: "ready",
      observedAt: OBSERVED.toISOString(),
      commitments: [],
      allocationHistory: { state: "available", items: [] },
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      ok: true,
      commons: {
        state: "ready",
        observedAt: OBSERVED.toISOString(),
        commitments: [],
        allocationHistory: { state: "available", items: [] },
      },
    });
  });

  it("returns ready with data as 200", async () => {
    const { handleCommonsGet } = await import("../../app/api/commons/route");
    const response = await handleCommonsGet(async () => ({
      state: "ready",
      observedAt: OBSERVED.toISOString(),
      commitments: [commitment()],
      allocationHistory: {
        state: "available",
        items: [delta()],
      },
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.commons.commitments[0].amount, "1000.123456789");
  });

  it("returns history partial failure as 200", async () => {
    const { handleCommonsGet } = await import("../../app/api/commons/route");
    const response = await handleCommonsGet(async () => ({
      state: "ready",
      observedAt: OBSERVED.toISOString(),
      commitments: [commitment({ amount: "7" })],
      allocationHistory: { state: "unavailable" },
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.commons.allocationHistory.state, "unavailable");
    assert.equal(body.commons.commitments[0].amount, "7");
  });

  it("maps authoritative commitment failure to non-2xx", async () => {
    const { handleCommonsGet } = await import("../../app/api/commons/route");
    const response = await handleCommonsGet(async () => {
      throw new CommonsError(
        "commons_read_failed",
        "Failed to load Commons commitments",
        500,
      );
    });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, "commons_read_failed");
    assert.doesNotMatch(JSON.stringify(body), /supabase|stack/i);
  });
});

describe("stage 9.3 source safety", () => {
  it("snapshot and route remain read-only with no Circulations", () => {
    for (const file of ["snapshot.ts", "commitments.ts"]) {
      const source = readFileSync(join(here, file), "utf8");
      assert.match(source, /server-only/);
      assert.doesNotMatch(source, /from ["']@\/lib\/circulation/);
      assert.doesNotMatch(source, /circulation_recipients/);
      assert.doesNotMatch(source, /\.from\(["']circulations["']\)/);
      assert.doesNotMatch(source, /writeContract|sendTransaction|insert\(|update\(|upsert\(/i);
      assert.doesNotMatch(source, /getPublicTreasurySnapshot|readNativeBalance|readErc20Balance/);
      assert.doesNotMatch(source, /Number\([^)]*delta|Number\([^)]*amount/);
    }

    const route = readFileSync(
      join(here, "../../app/api/commons/route.ts"),
      "utf8",
    );
    assert.doesNotMatch(route, /POST|PATCH|PUT|DELETE/);
    assert.doesNotMatch(route, /circulation/i);
    assert.match(route, /export async function GET/);
  });

  it("does not sum allocation deltas into current commitments", () => {
    const source = readFileSync(join(here, "snapshot.ts"), "utf8");
    assert.doesNotMatch(
      source,
      /reduce\(|sum\(|deltaAmount.*\+|commitment.*=.*delta/i,
    );
    assert.match(source, /getCommitments/);
  });
});
