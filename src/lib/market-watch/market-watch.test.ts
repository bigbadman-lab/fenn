/**
 * Market Watch 1.0A unit tests — classifiers, modes, policy, reorg, replay args.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  decodeEventLog,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
} from "viem";

import {
  parseMarketWatchMode,
  resolveMarketWatchRuntimeConfig,
  FENN_MARKET_WATCH_MODE_ENV,
  officialSourceKey,
} from "@/lib/market-watch/config";
import { validateMarketWatchConfigInput } from "@/lib/market-watch/config-loader";
import { classifyV2Swap } from "@/lib/market-watch/classify-v2";
import { classifyV3Swap } from "@/lib/market-watch/classify-v3";
import {
  decodeAndClassifySwap,
  toCanonicalSwapLog,
} from "@/lib/market-watch/decode";
import { canonicalEventKey, decideEventStatus } from "@/lib/market-watch/policy";
import { parseReplayArgs } from "@/lib/market-watch/replay";
import { assertCursorHashStillValid } from "@/lib/market-watch/tick";
import { resolveTokenOrder } from "@/lib/market-watch/token-order";
import {
  UNISWAP_V2_SWAP_ABI,
  UNISWAP_V2_SWAP_TOPIC,
  UNISWAP_V3_SWAP_ABI,
  UNISWAP_V3_SWAP_TOPIC,
} from "@/lib/market-watch/topics";
import { MarketWatchError } from "@/lib/market-watch/errors";
import type { MarketWatchTokenOrder } from "@/lib/market-watch/types";

const FENN = "0x1111111111111111111111111111111111111111";
const QUOTE = "0x2222222222222222222222222222222222222222";
const POOL = "0x3333333333333333333333333333333333333333";

const orderFenn0: MarketWatchTokenOrder = {
  token0: FENN,
  token1: QUOTE,
  fennIsToken0: true,
  quoteIsToken0: false,
};

const orderFenn1: MarketWatchTokenOrder = {
  token0: QUOTE,
  token1: FENN,
  fennIsToken0: false,
  quoteIsToken0: true,
};

describe("market-watch mode parsing", () => {
  it("defaults missing/invalid to disabled", () => {
    assert.equal(parseMarketWatchMode(undefined), "disabled");
    assert.equal(parseMarketWatchMode(""), "disabled");
    assert.equal(parseMarketWatchMode("LIVE"), "live");
    assert.equal(parseMarketWatchMode("nope"), "disabled");
  });

  it("resolves safe poll bounds", () => {
    const cfg = resolveMarketWatchRuntimeConfig({
      [FENN_MARKET_WATCH_MODE_ENV]: "dry_run",
      FENN_MARKET_WATCH_POLL_SECONDS: "3",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(cfg.mode, "dry_run");
    // below min falls back to default 10
    assert.equal(cfg.pollSeconds, 10);
    assert.equal(cfg.leaseKey, "market_watch");
  });
});

describe("token order", () => {
  it("accepts either ordering", () => {
    const a = resolveTokenOrder({
      token0: FENN,
      token1: QUOTE,
      fennToken: FENN,
      quoteToken: QUOTE,
    });
    assert.ok(!("ok" in a));
    assert.equal(a.fennIsToken0, true);

    const b = resolveTokenOrder({
      token0: QUOTE,
      token1: FENN,
      fennToken: FENN,
      quoteToken: QUOTE,
    });
    assert.ok(!("ok" in b));
    assert.equal(b.fennIsToken0, false);
  });

  it("rejects unexpected assets", () => {
    const bad = resolveTokenOrder({
      token0: FENN,
      token1: "0x9999999999999999999999999999999999999999",
      fennToken: FENN,
      quoteToken: QUOTE,
    });
    assert.deepEqual(bad, { ok: false, reason: "pool_token_mismatch" });
  });
});

describe("V2 classifier", () => {
  it("classifies acquisition (quote in, fenn out)", () => {
    const r = classifyV2Swap(
      {
        amount0In: BigInt(0),
        amount1In: BigInt(5) * BigInt(10) ** BigInt(18),
        amount0Out: BigInt(100) * BigInt(10) ** BigInt(18),
        amount1Out: BigInt(0),
      },
      orderFenn0,
    );
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") {
      assert.equal(r.eventType, "acquisition");
      assert.equal(r.fennAmountRaw, BigInt(100) * BigInt(10) ** BigInt(18));
      assert.equal(r.quoteAmountRaw, BigInt(5) * BigInt(10) ** BigInt(18));
    }
  });

  it("classifies disposal (fenn in, quote out)", () => {
    const r = classifyV2Swap(
      {
        amount0In: BigInt(50),
        amount1In: BigInt(0),
        amount0Out: BigInt(0),
        amount1Out: BigInt(2),
      },
      orderFenn0,
    );
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") assert.equal(r.eventType, "disposal");
  });

  it("suppresses dual-direction noise", () => {
    const r = classifyV2Swap(
      {
        amount0In: BigInt(1),
        amount1In: BigInt(1),
        amount0Out: BigInt(1),
        amount1Out: BigInt(0),
      },
      orderFenn0,
    );
    assert.equal(r.kind, "suppress");
  });

  it("handles fenn as token1", () => {
    const r = classifyV2Swap(
      {
        amount0In: BigInt(9),
        amount1In: BigInt(0),
        amount0Out: BigInt(0),
        amount1Out: BigInt(42),
      },
      orderFenn1,
    );
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") {
      assert.equal(r.eventType, "acquisition");
      assert.equal(r.fennAmountRaw, BigInt(42));
      assert.equal(r.quoteAmountRaw, BigInt(9));
    }
  });
});

describe("V3 classifier", () => {
  it("classifies acquisition from signed deltas (fenn token0)", () => {
    // pool sends fenn (neg), receives quote (pos)
    const r = classifyV3Swap(
      { amount0: -BigInt(1000), amount1: BigInt(5) },
      orderFenn0,
    );
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") {
      assert.equal(r.eventType, "acquisition");
      assert.equal(r.fennAmountRaw, BigInt(1000));
    }
  });

  it("classifies disposal", () => {
    const r = classifyV3Swap(
      { amount0: BigInt(1000), amount1: -BigInt(5) },
      orderFenn0,
    );
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") assert.equal(r.eventType, "disposal");
  });

  it("suppresses same-sign deltas", () => {
    const r = classifyV3Swap({ amount0: BigInt(1), amount1: BigInt(2) }, orderFenn0);
    assert.equal(r.kind, "suppress");
  });

  it("handles large int256 magnitudes", () => {
    const big = BigInt(10) ** BigInt(30);
    const r = classifyV3Swap(
      { amount0: -big, amount1: BigInt(7) },
      orderFenn0,
    );
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") assert.equal(r.fennAmountRaw, big);
  });
});

describe("publish policy", () => {
  it("dry_run never publishes", () => {
    const d = decideEventStatus({
      mode: "dry_run",
      eventType: "acquisition",
      fennAmountRaw: BigInt(1000000),
      minDisplayFennRaw: BigInt(1),
    });
    assert.equal(d.status, "observed");
    assert.equal(d.publishedAt, null);
  });

  it("live acquisition publishes above min", () => {
    const d = decideEventStatus({
      mode: "live",
      eventType: "acquisition",
      fennAmountRaw: BigInt(100),
      minDisplayFennRaw: BigInt(10),
    });
    assert.equal(d.status, "published");
    assert.ok(d.publishedAt);
  });

  it("live disposal stays observed", () => {
    const d = decideEventStatus({
      mode: "live",
      eventType: "disposal",
      fennAmountRaw: BigInt(100),
      minDisplayFennRaw: BigInt(1),
    });
    assert.equal(d.status, "observed");
    assert.equal(d.publishedAt, null);
  });

  it("suppresses dust with integer compare", () => {
    const d = decideEventStatus({
      mode: "live",
      eventType: "acquisition",
      fennAmountRaw: BigInt(9),
      minDisplayFennRaw: BigInt(10),
    });
    assert.equal(d.status, "suppressed");
    assert.equal(d.suppressReason, "below_min_display");
  });

  it("canonical event key is stable", () => {
    assert.equal(
      canonicalEventKey({
        chainId: 4663,
        transactionHash: "0xABC",
        logIndex: 2,
      }),
      "4663:0xabc:2",
    );
  });
});

describe("config validation", () => {
  it("incomplete without addresses", () => {
    const state = validateMarketWatchConfigInput({
      row: {
        id: 1,
        chain_id: 4663,
        token_address: null,
        token_decimals: null,
        token_symbol: null,
        pool_address: null,
        pool_kind: null,
        quote_token_address: null,
        quote_token_decimals: null,
        quote_token_symbol: null,
        launch_block: null,
        confirmation_depth: 5,
        min_display_fenn_raw: 0,
        classification_version: "mw_v1",
        enabled: false,
      },
    });
    assert.equal(state.status, "incomplete");
  });

  it("rejects custom pool kind", () => {
    const state = validateMarketWatchConfigInput({
      row: {
        id: 1,
        chain_id: 4663,
        token_address: FENN,
        token_decimals: 18,
        token_symbol: "FENN",
        pool_address: POOL,
        pool_kind: "custom",
        quote_token_address: QUOTE,
        quote_token_decimals: 18,
        quote_token_symbol: "WETH",
        launch_block: 100,
        confirmation_depth: 5,
        min_display_fenn_raw: "0",
        classification_version: "mw_v1",
        enabled: true,
      },
      poolToken0: FENN,
      poolToken1: QUOTE,
      officialToken: {
        chainId: 4663,
        contractAddress: FENN,
        decimals: 18,
        symbol: "FENN",
      },
    });
    assert.equal(state.status, "invalid");
    if (state.status === "invalid") {
      assert.equal(state.reason, "custom_pool_unsupported");
    }
  });

  it("ready when order + official token match", () => {
    const state = validateMarketWatchConfigInput({
      row: {
        id: 1,
        chain_id: 4663,
        token_address: FENN,
        token_decimals: 18,
        token_symbol: "FENN",
        pool_address: POOL,
        pool_kind: "uniswap_v2",
        quote_token_address: QUOTE,
        quote_token_decimals: 18,
        quote_token_symbol: "WETH",
        launch_block: "1000",
        confirmation_depth: 5,
        min_display_fenn_raw: "0",
        classification_version: "mw_v1",
        enabled: true,
      },
      poolToken0: FENN,
      poolToken1: QUOTE,
      officialToken: {
        chainId: 4663,
        contractAddress: FENN,
        decimals: 18,
        symbol: "FENN",
      },
    });
    assert.equal(state.status, "ready");
    if (state.status === "ready") {
      assert.equal(state.config.poolKind, "uniswap_v2");
      assert.equal(state.config.sourceKey, officialSourceKey(POOL));
    }
  });
});

describe("decode fixtures", () => {
  it("decodes V2 acquisition logs", () => {
    const topics = encodeEventTopics({
      abi: UNISWAP_V2_SWAP_ABI,
      eventName: "Swap",
      args: {
        sender: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    });
    const data = encodeAbiParameters(
      parseAbiParameters("uint256, uint256, uint256, uint256"),
      [BigInt(0), BigInt(5), BigInt(100), BigInt(0)],
    );
    const log = toCanonicalSwapLog({
      address: POOL,
      topics: topics as string[],
      data,
      blockNumber: BigInt(10),
      blockHash: ("0x" + "ab".repeat(32)) as Hex,
      transactionHash: ("0x" + "cd".repeat(32)) as Hex,
      logIndex: 0,
    });
    assert.ok(log);
    assert.equal(log!.topics[0], UNISWAP_V2_SWAP_TOPIC.toLowerCase());

    const result = decodeAndClassifySwap({
      log: log!,
      poolKind: "uniswap_v2",
      expectedPool: POOL,
      expectedTopic: UNISWAP_V2_SWAP_TOPIC,
      order: orderFenn0,
    });
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") assert.equal(result.eventType, "acquisition");
  });

  it("decodes V3 acquisition logs", () => {
    const topics = encodeEventTopics({
      abi: UNISWAP_V3_SWAP_ABI,
      eventName: "Swap",
      args: {
        sender: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        recipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    });
    // amount0, amount1, sqrtPriceX96, liquidity, tick
    const data = encodeAbiParameters(
      parseAbiParameters("int256, int256, uint160, uint128, int24"),
      [-BigInt(500), BigInt(9), BigInt(1), BigInt(1), 0],
    );
    const log = toCanonicalSwapLog({
      address: POOL,
      topics: topics as string[],
      data,
      blockNumber: BigInt(11),
      blockHash: ("0x" + "11".repeat(32)) as Hex,
      transactionHash: ("0x" + "22".repeat(32)) as Hex,
      logIndex: 1,
    });
    assert.ok(log);
    assert.equal(log!.topics[0], UNISWAP_V3_SWAP_TOPIC.toLowerCase());

    // sanity: round-trip decode
    const decoded = decodeEventLog({
      abi: UNISWAP_V3_SWAP_ABI,
      data: data as Hex,
      topics: topics as [Hex, ...Hex[]],
    });
    assert.equal(decoded.eventName, "Swap");

    const result = decodeAndClassifySwap({
      log: log!,
      poolKind: "uniswap_v3",
      expectedPool: POOL,
      expectedTopic: UNISWAP_V3_SWAP_TOPIC,
      order: orderFenn0,
    });
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      assert.equal(result.eventType, "acquisition");
      assert.equal(result.fennAmountRaw, BigInt(500));
    }
  });

  it("custom pool kind errors closed", () => {
    const log = toCanonicalSwapLog({
      address: POOL,
      topics: [UNISWAP_V2_SWAP_TOPIC],
      data: "0x",
      blockNumber: BigInt(1),
      blockHash: null,
      transactionHash: ("0x" + "33".repeat(32)) as Hex,
      logIndex: 0,
    })!;
    const result = decodeAndClassifySwap({
      log,
      poolKind: "custom",
      expectedPool: POOL,
      expectedTopic: UNISWAP_V2_SWAP_TOPIC,
      order: orderFenn0,
    });
    assert.equal(result.kind, "error");
  });
});

describe("cursor reorg foundation", () => {
  it("detects hash mismatch", async () => {
    await assert.rejects(
      () =>
        assertCursorHashStillValid({
          lastSafeBlock: BigInt(5),
          lastSafeBlockHash: "0x" + "aa".repeat(32),
          rpc: {
            getBlockNumber: async () => BigInt(10),
            getBlock: async () => ({
              hash: ("0x" + "bb".repeat(32)) as Hex,
              timestamp: BigInt(1),
              number: BigInt(5),
            }),
            getLogs: async () => [],
          },
        }),
      (e: unknown) =>
        e instanceof MarketWatchError && e.code === "mw_cursor_reorg",
    );
  });

  it("allows matching hash", async () => {
    const hash = ("0x" + "aa".repeat(32)) as Hex;
    await assertCursorHashStillValid({
      lastSafeBlock: BigInt(5),
      lastSafeBlockHash: hash,
      rpc: {
        getBlockNumber: async () => BigInt(10),
        getBlock: async () => ({
          hash,
          timestamp: BigInt(1),
          number: BigInt(5),
        }),
        getLogs: async () => [],
      },
    });
  });
});

describe("replay args", () => {
  it("defaults dry_run and requires bounds", () => {
    const args = parseReplayArgs([
      "--from-block",
      "10",
      "--to-block",
      "20",
    ]);
    assert.equal(args.mode, "dry_run");
    assert.equal(args.liveReplay, false);
    assert.equal(args.fromBlock, BigInt(10));
  });

  it("rejects live without --live-replay", () => {
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

describe("process-range persistence policy", () => {
  it("idempotent insert path reports duplicate", async () => {
    const { persistMarketWatchEvent } = await import(
      "@/lib/market-watch/persist"
    );
    const events: unknown[] = [];
    const admin = {
      from: () => ({
        insert: async (row: unknown) => {
          if (events.length > 0) {
            return {
              error: { message: "duplicate key", code: "23505" },
            };
          }
          events.push(row);
          return { error: null };
        },
      }),
    };
    const base = {
      chainId: 4663,
      eventType: "acquisition" as const,
      tokenAddress: FENN,
      poolAddress: POOL,
      quoteTokenAddress: QUOTE,
      transactionHash: "0x" + "dd".repeat(32),
      logIndex: 0,
      blockNumber: BigInt(1),
      blockHash: "0x" + "ee".repeat(32),
      blockTimestamp: null,
      fennAmountRaw: BigInt(10),
      quoteAmountRaw: BigInt(1),
      txFrom: null,
      classificationVersion: "mw_v1",
      status: "observed" as const,
      suppressReason: null,
      publishedAt: null,
    };
    const a = await persistMarketWatchEvent(base, admin as never);
    const b = await persistMarketWatchEvent(base, admin as never);
    assert.equal(a.outcome, "inserted");
    assert.equal(b.outcome, "duplicate");
  });
});

describe("worker disable tick", () => {
  it("disabled mode does not fetch chain", async () => {
    const { runMarketWatchTick } = await import("@/lib/market-watch/tick");
    let rpcCalled = false;
    const patches: unknown[] = [];
    const admin = {
      from: (table: string) => {
        if (table === "market_watch_worker_state") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    events_seen: 0,
                    acquisitions_classified: 0,
                    disposals_classified: 0,
                    suppressed_count: 0,
                  },
                  error: null,
                }),
              }),
            }),
            upsert: async (payload: unknown) => {
              patches.push(payload);
              return { error: null };
            },
          };
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      },
    };
    const result = await runMarketWatchTick(
      {
        mode: "disabled",
        pollSeconds: 10,
        leaseKey: "market_watch",
        leaseTtlSeconds: 55,
        maxBlockRange: 500,
        rpcTimeoutMs: 20_000,
        workerVersion: "1.0a",
      },
      {
        admin: admin as never,
        rpc: {
          getBlockNumber: async () => {
            rpcCalled = true;
            return BigInt(1);
          },
          getBlock: async () => {
            rpcCalled = true;
            return { hash: null, timestamp: BigInt(0), number: BigInt(0) };
          },
          getLogs: async () => {
            rpcCalled = true;
            return [];
          },
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.code, "mw_disabled");
    assert.equal(rpcCalled, false);
    assert.ok(patches.length >= 1);
  });
});

describe("worker loop lease skip", () => {
  it("skips tick body when lease busy", async () => {
    const { runMarketWatchWorkerLoop } = await import(
      "@/lib/market-watch/worker"
    );
    let ticks = 0;
    const result = await runMarketWatchWorkerLoop({
      runtime: {
        mode: "disabled",
        pollSeconds: 8,
        leaseKey: "market_watch",
        leaseTtlSeconds: 50,
        maxBlockRange: 100,
        rpcTimeoutMs: 5_000,
        workerVersion: "1.0a",
      },
      maxTicks: 1,
      sleep: async () => {},
      lease: {
        admin: {
          rpc: async () => ({ data: false, error: null }),
        },
      },
      tick: async () => {
        ticks += 1;
        return { ok: true, mode: "disabled" };
      },
      log: () => {},
    });
    assert.equal(result.ticks, 1);
    assert.equal(ticks, 0);
  });
});

describe("security / repo boundaries", () => {
  it("migration enforces service_role only grants", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260805130000_50_market_watch_foundation.sql",
      ),
      "utf8",
    );
    assert.match(sql, /REVOKE ALL ON TABLE public\.market_watch_events FROM anon/);
    assert.match(sql, /GRANT ALL ON TABLE public\.market_watch_events TO service_role/);
    assert.match(sql, /enabled boolean NOT NULL DEFAULT false/);
    assert.doesNotMatch(sql, /0x[a-fA-F0-9]{40}/); // no invented pool/token hex
  });

  it("render blueprint disables by default", () => {
    const yaml = readFileSync(join(process.cwd(), "render.yaml"), "utf8");
    assert.match(yaml, /fenn-market-watch/);
    assert.match(yaml, /FENN_MARKET_WATCH_MODE/);
    assert.match(yaml, /value: disabled/);
  });

  it("desk route is desk-gated file", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/desk/market-watch/route.ts"),
      "utf8",
    );
    assert.match(route, /requireFennDeskAccess/);
    assert.doesNotMatch(route, /createAdminClient.*from.*client/);
  });
});
