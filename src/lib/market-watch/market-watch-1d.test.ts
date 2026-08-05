/**
 * Market Watch 1.0D unit tests — reorg recovery, adaptive range, thresholds,
 * worker lease, classification fatal, Clearing reorg withdrawal contract.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  classifyRpcFailure,
  nextRangeAfterLimitError,
  rpcBackoffMs,
} from "@/lib/market-watch/adaptive-range";
import {
  findCommonAncestor,
  knownHashMap,
  remainsInClearingAfterReorg,
  reorgWalkPlan,
  recoverFromCursorReorg,
} from "@/lib/market-watch/reorg";
import {
  deriveReadinessVerdict,
  mapMarketWatchErrorPlain,
} from "@/lib/market-watch/desk-readiness";
import { parseVerifyArgs } from "@/lib/market-watch/verify";
import { parseReplayArgs } from "@/lib/market-watch/replay";
import {
  MARKET_WATCH_BLOCK_RANGE_FLOOR,
  MARKET_WATCH_HEARTBEAT_STALE_SECONDS,
  MARKET_WATCH_REORG_MAX_REWIND_BLOCKS,
  MARKET_WATCH_WORKER_VERSION,
} from "@/lib/market-watch/thresholds";
import { MarketWatchError } from "@/lib/market-watch/errors";
import { decideEventStatus } from "@/lib/market-watch/policy";
import { runMarketWatchWorkerLoop } from "@/lib/market-watch/worker";
import { withRpcRetry } from "@/lib/market-watch/rpc";
import type { MarketWatchRpcClient } from "@/lib/market-watch/rpc";
import type { Hex } from "viem";

describe("Market Watch 1.0D adaptive range", () => {
  it("halves range and floors", () => {
    assert.equal(nextRangeAfterLimitError(500, 25), 250);
    assert.equal(nextRangeAfterLimitError(40, 25), 25);
    assert.equal(nextRangeAfterLimitError(25, 25), 25);
  });

  it("classifies provider errors", () => {
    assert.equal(
      classifyRpcFailure(new Error("block range is too large")).kind,
      "range_limit",
    );
    assert.equal(
      classifyRpcFailure(new Error("429 Too Many Requests")).kind,
      "rate_limit",
    );
    assert.equal(
      classifyRpcFailure(new Error("request timed out")).kind,
      "timeout",
    );
  });

  it("backoff grows with attempt", () => {
    const a0 = rpcBackoffMs(0, 100, 0, () => 0);
    const a2 = rpcBackoffMs(2, 100, 0, () => 0);
    assert.equal(a0, 100);
    assert.equal(a2, 400);
  });

  it("withRpcRetry does not burn attempts on range_limit", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRpcRetry(
          async () => {
            calls += 1;
            throw new Error("block range is too large");
          },
          { attempts: 3, sleep: async () => {}, random: () => 0 },
        ),
      /block range/i,
    );
    assert.equal(calls, 1);
  });

  it("withRpcRetry retries transient then succeeds", async () => {
    let calls = 0;
    const v = await withRpcRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error("503 server error");
        return 42;
      },
      { attempts: 3, sleep: async () => {}, random: () => 0 },
    );
    assert.equal(v, 42);
    assert.equal(calls, 2);
  });
});

describe("Market Watch 1.0D reorg recovery", () => {
  it("plans bounded reverse walk including cursor", () => {
    const plan = reorgWalkPlan(BigInt(100), 5);
    assert.equal(plan[0], BigInt(100));
    assert.equal(plan.length, 6);
    assert.equal(plan[plan.length - 1], BigInt(95));
  });

  it("findCommonAncestor: no reorg when tip matches", async () => {
    const tipHash =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const rpc: MarketWatchRpcClient = {
      getBlockNumber: async () => BigInt(100),
      getBlock: async ({ blockNumber }) => ({
        hash: (blockNumber === BigInt(100)
          ? tipHash
          : "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") as Hex,
        timestamp: BigInt(1),
        number: blockNumber,
      }),
      getLogs: async () => [],
    };
    const a = await findCommonAncestor({
      rpc,
      lastSafeBlock: BigInt(100),
      lastSafeBlockHash: tipHash,
      maxRewind: 8,
    });
    assert.ok(a);
    assert.equal(a!.stepsWalked, 0);
  });

  it("findCommonAncestor: shallow reorg via known parent hash", async () => {
    const oldTip =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const parent =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    const newTip =
      "0x3333333333333333333333333333333333333333333333333333333333333333";
    const rpc: MarketWatchRpcClient = {
      getBlockNumber: async () => BigInt(100),
      getBlock: async ({ blockNumber }) => {
        const n = Number(blockNumber);
        const map: Record<number, string> = {
          100: newTip,
          99: parent,
          98: "0x4444444444444444444444444444444444444444444444444444444444444444",
        };
        return {
          hash: (map[n] ??
            "0x5555555555555555555555555555555555555555555555555555555555555555") as Hex,
          timestamp: BigInt(1),
          number: blockNumber,
        };
      },
      getLogs: async () => [],
    };
    const a = await findCommonAncestor({
      rpc,
      lastSafeBlock: BigInt(100),
      lastSafeBlockHash: oldTip,
      maxRewind: 8,
      knownHashes: [
        { blockNumber: BigInt(99), blockHash: parent },
        { blockNumber: BigInt(100), blockHash: oldTip },
      ],
    });
    assert.ok(a);
    assert.equal(a!.blockNumber, BigInt(99));
    assert.equal(a!.stepsWalked, 1);
  });

  it("findCommonAncestor: event replaced — deeper ancestor when parent diverged", async () => {
    const good98 =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const rpc: MarketWatchRpcClient = {
      getBlockNumber: async () => BigInt(100),
      getBlock: async ({ blockNumber }) => {
        const n = Number(blockNumber);
        const map: Record<number, string> = {
          100: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          99: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          98: good98,
        };
        return {
          hash: (map[n] ??
            "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd") as Hex,
          timestamp: BigInt(1),
          number: blockNumber,
        };
      },
      getLogs: async () => [],
    };
    const a = await findCommonAncestor({
      rpc,
      lastSafeBlock: BigInt(100),
      lastSafeBlockHash:
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      maxRewind: 8,
      knownHashes: [
        { blockNumber: BigInt(98), blockHash: good98 },
        {
          blockNumber: BigInt(99),
          blockHash:
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      ],
    });
    assert.ok(a);
    assert.equal(a!.blockNumber, BigInt(98));
    assert.equal(a!.stepsWalked, 2);
  });

  it("findCommonAncestor: rewind limit with no matching known hash ⇒ null", async () => {
    const rpc: MarketWatchRpcClient = {
      getBlockNumber: async () => BigInt(50),
      getBlock: async ({ blockNumber }) => ({
        hash: `0x${blockNumber.toString(16).padStart(64, "0")}` as Hex,
        timestamp: BigInt(1),
        number: blockNumber,
      }),
      getLogs: async () => [],
    };
    const a = await findCommonAncestor({
      rpc,
      lastSafeBlock: BigInt(50),
      lastSafeBlockHash:
        "0x9999999999999999999999999999999999999999999999999999999999999999",
      maxRewind: 3,
      knownHashes: [],
    });
    assert.equal(a, null);
  });

  it("recoverFromCursorReorg marks reorged and rewinds cursor", async () => {
    const parent =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    const oldTip =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const newTip =
      "0x3333333333333333333333333333333333333333333333333333333333333333";

    let reorgUpdates = 0;
    let cursorWrites = 0;
    const admin = {
      from(table: string) {
        if (table === "market_watch_events") {
          return {
            update() {
              return {
                eq() {
                  return this;
                },
                gt() {
                  return this;
                },
                neq() {
                  return this;
                },
                select() {
                  reorgUpdates += 1;
                  return Promise.resolve({ data: [{ id: "a" }], error: null });
                },
              };
            },
            select() {
              return {
                eq() {
                  return this;
                },
                lte() {
                  return this;
                },
                not() {
                  return this;
                },
                order() {
                  return this;
                },
                limit() {
                  return Promise.resolve({ data: [], error: null });
                },
              };
            },
          };
        }
        if (table === "market_watch_cursors") {
          return {
            upsert() {
              cursorWrites += 1;
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const rpc: MarketWatchRpcClient = {
      getBlockNumber: async () => BigInt(100),
      getBlock: async ({ blockNumber }) => ({
        hash: (blockNumber === BigInt(100) ? newTip : parent) as Hex,
        timestamp: BigInt(1),
        number: blockNumber,
      }),
      getLogs: async () => [],
    };

    const result = await recoverFromCursorReorg({
      rpc,
      admin: admin as never,
      knownHashes: [{ blockNumber: BigInt(99), blockHash: parent }],
      cursor: {
        sourceKey: "official_pool:test",
        chainId: 4663,
        poolAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        lastSafeBlock: BigInt(100),
        lastSafeBlockHash: oldTip,
        classificationVersion: "mw_v1",
      },
      log: () => {},
    });

    assert.equal(result.outcome, "recovered");
    if (result.outcome === "recovered") {
      assert.equal(result.ancestorBlock, BigInt(99));
      assert.equal(result.eventsMarked, 1);
    }
    assert.ok(reorgUpdates >= 1);
    assert.ok(cursorWrites >= 1);
  });

  it("reorged status leaves Clearing; published stays until reorged", () => {
    assert.equal(remainsInClearingAfterReorg("published"), true);
    assert.equal(remainsInClearingAfterReorg("reorged"), false);
    assert.equal(remainsInClearingAfterReorg("observed"), false);
    assert.equal(
      knownHashMap([{ blockNumber: BigInt(1), blockHash: "0xab" }]).get("1"),
      "0xab",
    );
  });

  it("live publish path is the only Clearing-eligible acquisition status", () => {
    const published = decideEventStatus({
      mode: "live",
      eventType: "acquisition",
      fennAmountRaw: BigInt(1000),
      minDisplayFennRaw: BigInt(0),
    });
    assert.equal(published.status, "published");
    const dry = decideEventStatus({
      mode: "dry_run",
      eventType: "acquisition",
      fennAmountRaw: BigInt(1000),
      minDisplayFennRaw: BigInt(0),
    });
    assert.equal(dry.status, "observed");
  });
});

describe("Market Watch 1.0D readiness thresholds", () => {
  it("exposes threshold constants", () => {
    assert.ok(MARKET_WATCH_HEARTBEAT_STALE_SECONDS >= 60);
    assert.ok(MARKET_WATCH_REORG_MAX_REWIND_BLOCKS >= 16);
    assert.ok(MARKET_WATCH_BLOCK_RANGE_FLOOR >= 1);
    assert.equal(MARKET_WATCH_WORKER_VERSION, "1.0d");
  });

  it("stalled on reorg_stall and classification_fatal", () => {
    assert.equal(
      deriveReadinessVerdict({
        configComplete: true,
        workerMode: "live",
        configEnabled: true,
        heartbeatStatus: "current",
        lastErrorCode: "mw_reorg_stall",
        cursorLagBlocks: 2,
        confirmationDepth: 5,
        cursorExists: true,
        lastProcessedBlock: 1,
      }),
      "stalled",
    );
    assert.match(
      mapMarketWatchErrorPlain("mw_reorg_stall") ?? "",
      /REWIND LIMIT/,
    );
    assert.equal(
      deriveReadinessVerdict({
        configComplete: true,
        workerMode: "live",
        configEnabled: true,
        heartbeatStatus: "current",
        lastErrorCode: "mw_classification_fatal",
        cursorLagBlocks: 2,
        confirmationDepth: 5,
        cursorExists: true,
        lastProcessedBlock: 1,
      }),
      "stalled",
    );
  });

  it("stalled lag vs degraded lag", () => {
    assert.equal(
      deriveReadinessVerdict({
        configComplete: true,
        workerMode: "live",
        configEnabled: true,
        heartbeatStatus: "current",
        lastErrorCode: null,
        cursorLagBlocks: 5 + 20 + 1,
        confirmationDepth: 5,
        cursorExists: true,
        lastProcessedBlock: 1,
      }),
      "degraded",
    );
    assert.equal(
      deriveReadinessVerdict({
        configComplete: true,
        workerMode: "live",
        configEnabled: true,
        heartbeatStatus: "current",
        lastErrorCode: null,
        cursorLagBlocks: 5 + 200 + 1,
        confirmationDepth: 5,
        cursorExists: true,
        lastProcessedBlock: 1,
      }),
      "stalled",
    );
  });
});

describe("Market Watch 1.0D verify and replay CLI args", () => {
  it("verify requires bounds", () => {
    assert.throws(() => parseVerifyArgs([]), MarketWatchError);
    const a = parseVerifyArgs(["--from-block", "1", "--to-block", "10"]);
    assert.equal(a.fromBlock, BigInt(1));
    assert.equal(a.toBlock, BigInt(10));
  });

  it("replay reclassify flag and live guards", () => {
    const r = parseReplayArgs([
      "--from-block",
      "1",
      "--to-block",
      "2",
      "--reclassify",
    ]);
    assert.equal(r.reclassify, true);
    assert.equal(r.mode, "dry_run");
    assert.throws(
      () =>
        parseReplayArgs([
          "--from-block",
          "1",
          "--to-block",
          "2",
          "--mode",
          "live",
        ]),
      MarketWatchError,
    );
  });
});

describe("Market Watch 1.0D lease contention (simulated workers)", () => {
  it("second worker skips when lease busy; first tick runs", async () => {
    let acquireCalls = 0;
    const ticks: string[] = [];
    const leaseAdmin = {
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        if (fn === "try_acquire_ops_runtime_lease") {
          acquireCalls += 1;
          const holder = String(args?.p_holder_id ?? "");
          if (holder.startsWith("w1")) {
            return { data: true, error: null };
          }
          return { data: false, error: null };
        }
        if (fn === "release_ops_runtime_lease") {
          return { data: true, error: null };
        }
        return { data: null, error: { message: "unknown" } };
      },
    };

    const w1 = runMarketWatchWorkerLoop({
      runtime: {
        mode: "disabled",
        pollSeconds: 0,
        leaseKey: "market_watch_test",
        leaseTtlSeconds: 30,
        maxBlockRange: 100,
        rpcTimeoutMs: 1000,
        workerVersion: "1.0d",
      },
      maxTicks: 1,
      sleep: async () => {},
      lease: {
        admin: leaseAdmin as never,
        newHolderId: () => "w1:1",
      },
      tick: async () => {
        ticks.push("w1");
        return { ok: true, mode: "disabled" };
      },
      log: () => {},
    });

    const w2 = runMarketWatchWorkerLoop({
      runtime: {
        mode: "disabled",
        pollSeconds: 0,
        leaseKey: "market_watch_test",
        leaseTtlSeconds: 30,
        maxBlockRange: 100,
        rpcTimeoutMs: 1000,
        workerVersion: "1.0d",
      },
      maxTicks: 1,
      sleep: async () => {},
      lease: {
        admin: leaseAdmin as never,
        newHolderId: () => "w2:2",
      },
      tick: async () => {
        ticks.push("w2");
        return { ok: true, mode: "disabled" };
      },
      log: () => {},
    });

    await Promise.all([w1, w2]);
    assert.ok(acquireCalls >= 2);
    assert.deepEqual(ticks, ["w1"]);
  });
});

describe("Market Watch 1.0D wiring contracts", () => {
  it("tick uses ensureCursorCanonical and reorg recovery", () => {
    const tick = readFileSync(
      join(process.cwd(), "src/lib/market-watch/tick.ts"),
      "utf8",
    );
    assert.match(tick, /ensureCursorCanonical|recoverFromCursorReorg/);
    assert.match(tick, /assertRobinhoodChainId/);
  });

  it("rpc adaptive getLogs and verify tool exist", () => {
    const rpc = readFileSync(
      join(process.cwd(), "src/lib/market-watch/rpc.ts"),
      "utf8",
    );
    assert.match(rpc, /range_reduced|nextRangeAfterLimitError/);
    assert.match(rpc, /rpcBackoffMs/);
    const pkg = readFileSync(join(process.cwd(), "package.json"), "utf8");
    assert.match(pkg, /market-watch:verify/);
  });

  it("Clearing feed excludes non-published including reorged", () => {
    const feed = readFileSync(
      join(process.cwd(), "src/lib/clearing/feed.ts"),
      "utf8",
    );
    assert.match(feed, /eq\("status", "published"\)/);
    assert.match(feed, /eq\("event_type", "acquisition"\)/);
  });

  it("runbook documents activation and emergency pause", () => {
    const doc = readFileSync(
      join(process.cwd(), "docs/market-watch-production-runbook.md"),
      "utf8",
    );
    assert.match(doc, /ACTIVATION SEQUENCE|activation sequence/i);
    assert.match(doc, /EMERGENCY|disabled|dry_run/i);
    assert.match(doc, /reorg/i);
  });

  it("render market-watch is separate and disabled by default", () => {
    const yaml = readFileSync(join(process.cwd(), "render.yaml"), "utf8");
    assert.match(yaml, /fenn-market-watch/);
    assert.match(yaml, /FENN_MARKET_WATCH_MODE[\s\S]*disabled/);
    assert.match(yaml, /FENN_MARKET_WATCH_LEASE_KEY/);
  });
});
