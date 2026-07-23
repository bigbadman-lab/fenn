import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { TreasuryAssetRow } from "./asset-map";
import { toTreasuryAmount } from "./amounts";
import { ROBINHOOD_CHAIN_ID } from "./chain-definition";
import { TreasuryError } from "./errors";
import { getPublicTreasurySnapshot } from "./snapshot";
import type { PublicTreasuryContribution } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const TREASURY = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const OBSERVED = new Date("2026-07-23T12:00:00.000Z");

function nativeRow(overrides: Partial<TreasuryAssetRow> = {}): TreasuryAssetRow {
  return {
    id: "eth",
    symbol: "ETH",
    name: "Ether",
    chain_id: ROBINHOOD_CHAIN_ID,
    contract_address: null,
    decimals: 18,
    display_order: 0,
    is_tracked: true,
    ...overrides,
  };
}

function erc20Row(overrides: Partial<TreasuryAssetRow> = {}): TreasuryAssetRow {
  return {
    id: "token",
    symbol: "USDC",
    name: "USD Coin",
    chain_id: ROBINHOOD_CHAIN_ID,
    contract_address: TOKEN,
    decimals: 6,
    display_order: 1,
    is_tracked: true,
    ...overrides,
  };
}

function contrib(
  overrides: Partial<PublicTreasuryContribution> = {},
): PublicTreasuryContribution {
  return {
    id: "c1",
    assetSymbol: "ETH",
    amount: "1.0",
    amountRaw: "1000000000000000000",
    valueUsdAtReceipt: null,
    txHash: "0xabc",
    fromAddress: TREASURY,
    projectName: "Partner",
    purpose: "grant",
    designation: "treasury",
    verifiedAt: "2026-07-02T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getPublicTreasurySnapshot", () => {
  it("returns unconfigured without chain calls", async () => {
    let chainCalls = 0;
    const snapshot = await getPublicTreasurySnapshot({
      getConfig: async () => ({ configured: false }),
      listAssetRows: async () => {
        throw new Error("should not load assets");
      },
      getContributions: async () => {
        throw new Error("should not load contributions");
      },
      createClient: () => {
        chainCalls += 1;
        throw new Error("should not create client");
      },
      readNative: async () => {
        chainCalls += 1;
        throw new Error("no");
      },
      readErc20: async () => {
        chainCalls += 1;
        throw new Error("no");
      },
      now: () => OBSERVED,
    });
    assert.deepEqual(snapshot, { state: "unconfigured" });
    assert.equal(chainCalls, 0);
  });

  it("formats native ETH balance exactly", async () => {
    const raw = BigInt(5) * BigInt(10) ** BigInt(18);
    const holders: string[] = [];
    const snapshot = await getPublicTreasurySnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: TREASURY,
      }),
      listAssetRows: async () => [nativeRow()],
      getContributions: async () => [],
      createClient: () => ({}) as never,
      readNative: async (holder) => {
        holders.push(holder);
        return toTreasuryAmount(raw, 18);
      },
      readErc20: async () => {
        throw new Error("ERC-20 should not run");
      },
      now: () => OBSERVED,
    });
    assert.equal(snapshot.state, "ready");
    if (snapshot.state !== "ready") return;
    assert.equal(snapshot.treasuryAddress, TREASURY);
    assert.equal(snapshot.observedAt, OBSERVED.toISOString());
    assert.equal(snapshot.assets.length, 1);
    const asset = snapshot.assets[0];
    assert.equal(asset.state, "available");
    if (asset.state === "available") {
      assert.equal(asset.balance, "5");
      assert.equal(asset.symbol, "ETH");
      assert.equal(asset.contractAddress, null);
    }
    assert.deepEqual(holders, [TREASURY]);
  });

  it("formats ERC-20 large bigint exactly", async () => {
    const raw = BigInt("123456789012345678901234567");
    const holders: string[] = [];
    const snapshot = await getPublicTreasurySnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: TREASURY,
      }),
      listAssetRows: async () => [erc20Row({ decimals: 18 })],
      getContributions: async () => [],
      createClient: () => ({}) as never,
      readNative: async () => {
        throw new Error("native should not run");
      },
      readErc20: async (input) => {
        holders.push(input.holder);
        assert.equal(input.tokenAddress, TOKEN);
        return toTreasuryAmount(raw, 18);
      },
      now: () => OBSERVED,
    });
    assert.equal(snapshot.state, "ready");
    if (snapshot.state !== "ready") return;
    const asset = snapshot.assets[0];
    assert.equal(asset.state, "available");
    if (asset.state === "available") {
      assert.equal(asset.balance, "123456789.012345678901234567");
    }
    assert.deepEqual(holders, [TREASURY]);
  });

  it("returns multiple assets in display order", async () => {
    const snapshot = await getPublicTreasurySnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: TREASURY,
      }),
      listAssetRows: async () => [nativeRow(), erc20Row()],
      getContributions: async () => [],
      createClient: () => ({}) as never,
      readNative: async () => toTreasuryAmount(BigInt(1) * BigInt(10) ** BigInt(18), 18),
      readErc20: async () => toTreasuryAmount(BigInt(2_000_000), 6),
      now: () => OBSERVED,
    });
    assert.equal(snapshot.state, "ready");
    if (snapshot.state !== "ready") return;
    assert.deepEqual(
      snapshot.assets.map((a) => a.symbol),
      ["ETH", "USDC"],
    );
    assert.equal(snapshot.assets[0].state, "available");
    assert.equal(snapshot.assets[1].state, "available");
    if (
      snapshot.assets[0].state === "available" &&
      snapshot.assets[1].state === "available"
    ) {
      assert.equal(snapshot.assets[0].balance, "1");
      assert.equal(snapshot.assets[1].balance, "2");
    }
  });

  it("treats successful zero raw balance as known zero, not unavailable", async () => {
    const snapshot = await getPublicTreasurySnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: TREASURY,
      }),
      listAssetRows: async () => [nativeRow()],
      getContributions: async () => [],
      createClient: () => ({}) as never,
      readNative: async () => toTreasuryAmount(BigInt(0), 18),
      readErc20: async () => {
        throw new Error("no");
      },
      now: () => OBSERVED,
    });
    assert.equal(snapshot.state, "ready");
    if (snapshot.state !== "ready") return;
    const asset = snapshot.assets[0];
    assert.equal(asset.state, "available");
    if (asset.state === "available") {
      assert.equal(asset.balance, "0");
    }
  });

  it("marks one failed asset unavailable without zeroing others", async () => {
    const snapshot = await getPublicTreasurySnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: TREASURY,
      }),
      listAssetRows: async () => [nativeRow(), erc20Row()],
      getContributions: async () => [],
      createClient: () => ({}) as never,
      readNative: async () => toTreasuryAmount(BigInt(3) * BigInt(10) ** BigInt(18), 18),
      readErc20: async () => {
        throw new TreasuryError("treasury_read_failed", "boom", 502);
      },
      now: () => OBSERVED,
    });
    assert.equal(snapshot.state, "ready");
    if (snapshot.state !== "ready") return;
    assert.equal(snapshot.assets[0].state, "available");
    if (snapshot.assets[0].state === "available") {
      assert.equal(snapshot.assets[0].balance, "3");
    }
    assert.equal(snapshot.assets[1].state, "unavailable");
    if (snapshot.assets[1].state === "unavailable") {
      assert.equal(snapshot.assets[1].reason, "rpc_failed");
      assert.equal("balance" in snapshot.assets[1], false);
    }
  });

  it("returns unavailable when every live read fails", async () => {
    const snapshot = await getPublicTreasurySnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: TREASURY,
      }),
      listAssetRows: async () => [nativeRow(), erc20Row()],
      getContributions: async () => [],
      createClient: () => ({}) as never,
      readNative: async () => {
        throw new Error("rpc down");
      },
      readErc20: async () => {
        throw new Error("rpc down");
      },
      now: () => OBSERVED,
    });
    assert.equal(snapshot.state, "unavailable");
    if (snapshot.state !== "unavailable") return;
    assert.equal(snapshot.treasuryAddress, TREASURY);
    assert.ok(snapshot.assets.every((a) => a.state === "unavailable"));
  });

  it("returns unavailable when RPC client cannot be created", async () => {
    let readCalls = 0;
    const snapshot = await getPublicTreasurySnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: TREASURY,
      }),
      listAssetRows: async () => [nativeRow()],
      getContributions: async () => [],
      createClient: () => {
        throw new TreasuryError(
          "treasury_rpc_unavailable",
          "Robinhood Chain RPC is not configured",
          503,
        );
      },
      readNative: async () => {
        readCalls += 1;
        return toTreasuryAmount(BigInt(0), 18);
      },
      readErc20: async () => {
        readCalls += 1;
        return toTreasuryAmount(BigInt(0), 6);
      },
      now: () => OBSERVED,
    });
    assert.equal(snapshot.state, "unavailable");
    assert.equal(readCalls, 0);
    if (snapshot.state !== "unavailable") return;
    assert.equal(snapshot.assets[0].state, "unavailable");
  });

  it("does not chain-read wrong-chain assets", async () => {
    let chainCalls = 0;
    const snapshot = await getPublicTreasurySnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: TREASURY,
      }),
      listAssetRows: async () => [
        nativeRow({ chain_id: 1, id: "bad", symbol: "ETH-MAIN" }),
        nativeRow(),
      ],
      getContributions: async () => [],
      createClient: () => ({}) as never,
      readNative: async () => {
        chainCalls += 1;
        return toTreasuryAmount(BigInt(1) * BigInt(10) ** BigInt(18), 18);
      },
      readErc20: async () => {
        chainCalls += 1;
        throw new Error("no");
      },
      now: () => OBSERVED,
    });
    assert.equal(snapshot.state, "ready");
    if (snapshot.state !== "ready") return;
    assert.equal(snapshot.assets[0].state, "unavailable");
    if (snapshot.assets[0].state === "unavailable") {
      assert.equal(snapshot.assets[0].reason, "configuration_error");
    }
    assert.equal(snapshot.assets[1].state, "available");
    assert.equal(chainCalls, 1);
  });

  it("always uses configured Treasury address as holder", async () => {
    const holders: string[] = [];
    await getPublicTreasurySnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: TREASURY,
      }),
      listAssetRows: async () => [nativeRow(), erc20Row()],
      getContributions: async () => [],
      createClient: () => ({}) as never,
      readNative: async (holder) => {
        holders.push(holder);
        return toTreasuryAmount(BigInt(0), 18);
      },
      readErc20: async (input) => {
        holders.push(input.holder);
        return toTreasuryAmount(BigInt(0), 6);
      },
      now: () => OBSERVED,
    });
    assert.deepEqual(holders, [TREASURY, TREASURY]);
  });

  it("includes verified contributions without affecting balances", async () => {
    const history = [contrib({ amount: "999" })];
    const snapshot = await getPublicTreasurySnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: TREASURY,
      }),
      listAssetRows: async () => [nativeRow()],
      getContributions: async () => history,
      createClient: () => ({}) as never,
      readNative: async () => toTreasuryAmount(BigInt(1), 18),
      readErc20: async () => {
        throw new Error("no");
      },
      now: () => OBSERVED,
    });
    assert.equal(snapshot.state, "ready");
    if (snapshot.state !== "ready") return;
    assert.equal(snapshot.contributions.length, 1);
    assert.equal(snapshot.contributions[0].amount, "999");
    const asset = snapshot.assets[0];
    assert.equal(asset.state, "available");
    if (asset.state === "available") {
      assert.equal(asset.balance, "0.000000000000000001");
    }
  });

  it("ready with empty assets when configured but none tracked", async () => {
    let chainCalls = 0;
    const snapshot = await getPublicTreasurySnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: TREASURY,
      }),
      listAssetRows: async () => [],
      getContributions: async () => [],
      createClient: () => {
        chainCalls += 1;
        throw new Error("no client");
      },
      readNative: async () => {
        chainCalls += 1;
        throw new Error("no");
      },
      readErc20: async () => {
        chainCalls += 1;
        throw new Error("no");
      },
      now: () => OBSERVED,
    });
    assert.deepEqual(snapshot, {
      state: "ready",
      treasuryAddress: TREASURY,
      observedAt: OBSERVED.toISOString(),
      assets: [],
      contributions: [],
    });
    assert.equal(chainCalls, 0);
  });

  it("public DTO omits notes, actor IDs, and RPC URL", async () => {
    const snapshot = await getPublicTreasurySnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: TREASURY,
      }),
      listAssetRows: async () => [nativeRow()],
      getContributions: async () => [contrib()],
      createClient: () => ({}) as never,
      readNative: async () => toTreasuryAmount(BigInt(0), 18),
      readErc20: async () => {
        throw new Error("no");
      },
      now: () => OBSERVED,
    });
    const json = JSON.stringify(snapshot);
    assert.doesNotMatch(json, /notes|verified_by|rpcUrl|ROBINHOOD_CHAIN_RPC/i);
    assert.doesNotMatch(json, /"id":"eth"/); // internal asset id not exposed
  });
});

describe("GET /api/treasury route", () => {
  it("is public with no-store / force-dynamic", () => {
    const source = readFileSync(
      join(here, "../../app/api/treasury/route.ts"),
      "utf8",
    );
    assert.match(source, /getPublicTreasurySnapshot/);
    assert.doesNotMatch(source, /getVerifiedPrivyUser|from ["']@\/lib\/auth/);
    assert.doesNotMatch(source, /Authorization/);
    assert.match(source, /No Privy authentication/);
    assert.match(source, /force-dynamic/);
    assert.match(source, /no-store/);
  });

  it("returns unconfigured as 200", async () => {
    const { handleTreasuryGet } = await import("../../app/api/treasury/route");
    const response = await handleTreasuryGet(async () => ({
      state: "unconfigured",
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      ok: true,
      treasury: { state: "unconfigured" },
    });
  });

  it("returns ready snapshot as 200", async () => {
    const { handleTreasuryGet } = await import("../../app/api/treasury/route");
    const response = await handleTreasuryGet(async () => ({
      state: "ready",
      treasuryAddress: TREASURY,
      observedAt: OBSERVED.toISOString(),
      assets: [
        {
          symbol: "ETH",
          name: "Ether",
          chainId: ROBINHOOD_CHAIN_ID,
          contractAddress: null,
          decimals: 18,
          state: "available",
          balance: "5",
        },
      ],
      contributions: [],
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.treasury.state, "ready");
    assert.equal(body.treasury.assets[0].balance, "5");
  });

  it("returns unavailable as 200", async () => {
    const { handleTreasuryGet } = await import("../../app/api/treasury/route");
    const response = await handleTreasuryGet(async () => ({
      state: "unavailable",
      treasuryAddress: TREASURY,
      observedAt: OBSERVED.toISOString(),
      assets: [
        {
          symbol: "ETH",
          name: null,
          chainId: ROBINHOOD_CHAIN_ID,
          contractAddress: null,
          decimals: 18,
          state: "unavailable",
          reason: "rpc_failed",
        },
      ],
      contributions: [],
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.treasury.state, "unavailable");
  });

  it("maps unexpected service failure to non-2xx", async () => {
    const { handleTreasuryGet } = await import("../../app/api/treasury/route");
    const response = await handleTreasuryGet(async () => {
      throw new TreasuryError(
        "treasury_config_failed",
        "Failed to load Treasury configuration",
        500,
      );
    });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, "treasury_config_failed");
    assert.doesNotMatch(JSON.stringify(body), /rpc|viem|supabase/i);
  });
});

describe("stage 9.2 source safety", () => {
  it("snapshot and route remain read-only and server-side", () => {
    for (const file of ["snapshot.ts", "contributions-query.ts"]) {
      const source = readFileSync(join(here, file), "utf8");
      assert.match(source, /server-only/);
      assert.doesNotMatch(
        source,
        /writeContract|sendTransaction|privateKey|mnemonic/i,
      );
      assert.doesNotMatch(source, /circulations|circulation_recipients/);
      assert.doesNotMatch(source, /from ["']@\/lib\/circulation/);
      assert.doesNotMatch(source, /commons_commitments/);
      assert.doesNotMatch(source, /balance_raw|cached_balance|last_balance/);
      assert.doesNotMatch(source, /NEXT_PUBLIC_.*RPC/);
    }

    const route = readFileSync(
      join(here, "../../app/api/treasury/route.ts"),
      "utf8",
    );
    assert.doesNotMatch(
      route,
      /writeContract|sendTransaction|privateKey|mnemonic/i,
    );
    assert.doesNotMatch(route, /commons|circulation/i);
  });

  it("does not sum contributions into holdings", () => {
    const source = readFileSync(join(here, "snapshot.ts"), "utf8");
    assert.doesNotMatch(source, /sum\(.*contribution|contribution.*\+|held\s*=/i);
    assert.match(source, /readNative|readErc20/);
  });
});
