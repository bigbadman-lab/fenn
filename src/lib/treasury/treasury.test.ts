import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseTokenAmountToRaw, toTreasuryAmount } from "./amounts";
import { toTrackedAsset } from "./asset-map";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_CHAIN_SOURCE,
  ROBINHOOD_NATIVE_CURRENCY,
} from "./chain-definition";
import { toPublicTreasuryContribution } from "./contributions";
import { TreasuryError } from "./errors";

const here = dirname(fileURLToPath(import.meta.url));
const PROFILE_WALLET = "0x1111111111111111111111111111111111111111";

describe("Robinhood Chain definition", () => {
  it("locks mainnet chain ID 4663 from official docs", () => {
    assert.equal(ROBINHOOD_CHAIN_ID, 4663);
    assert.equal(ROBINHOOD_NATIVE_CURRENCY.symbol, "ETH");
    assert.equal(ROBINHOOD_NATIVE_CURRENCY.decimals, 18);
    assert.match(ROBINHOOD_CHAIN_SOURCE, /docs\.robinhood\.com\/chain/);
  });
});

describe("getTreasuryConfig", () => {
  it("returns unconfigured when no row exists", async () => {
    const { getTreasuryConfig } = await import("./config");
    const admin = {
      from() {
        return {
          select() {
            return {
              async maybeSingle() {
                return { data: null, error: null };
              },
            };
          },
        };
      },
    };
    const config = await getTreasuryConfig(admin as never);
    assert.deepEqual(config, { configured: false });
  });

  it("returns normalized DB wallet when configured", async () => {
    const { getTreasuryConfig } = await import("./config");
    const admin = {
      from() {
        return {
          select() {
            return {
              async maybeSingle() {
                return {
                  data: { treasury_wallet_address: PROFILE_WALLET },
                  error: null,
                };
              },
            };
          },
        };
      },
    };
    const config = await getTreasuryConfig(admin as never);
    assert.deepEqual(config, {
      configured: true,
      walletAddress: PROFILE_WALLET,
    });
  });

  it("fails closed on malformed DB wallet", async () => {
    const { getTreasuryConfig } = await import("./config");
    const admin = {
      from() {
        return {
          select() {
            return {
              async maybeSingle() {
                return {
                  data: { treasury_wallet_address: "not-an-address" },
                  error: null,
                };
              },
            };
          },
        };
      },
    };
    await assert.rejects(
      () => getTreasuryConfig(admin as never),
      (err: unknown) =>
        err instanceof TreasuryError && err.code === "treasury_invalid_address",
    );
  });

  it("does not use env bootstrap inside getTreasuryConfig", async () => {
    const source = readFileSync(join(here, "config.ts"), "utf8");
    assert.match(source, /treasury_config/);
    assert.match(source, /readTreasuryBootstrapAddressFromEnv/);
    const start = source.indexOf("export async function getTreasuryConfig");
    const end = source.indexOf(
      "export function readTreasuryBootstrapAddressFromEnv",
    );
    assert.ok(start >= 0 && end > start);
    const body = source.slice(start, end);
    assert.doesNotMatch(body, /process\.env/);
    assert.doesNotMatch(body, /FENN_TREASURY_ADDRESS/);
    assert.doesNotMatch(body, /dbAddress|envAddress/);
  });

  it("env bootstrap is explicit and separate", async () => {
    const { readTreasuryBootstrapAddressFromEnv } = await import("./config");
    assert.equal(readTreasuryBootstrapAddressFromEnv(""), null);
    assert.equal(readTreasuryBootstrapAddressFromEnv(undefined), null);
    assert.equal(
      readTreasuryBootstrapAddressFromEnv(PROFILE_WALLET.toUpperCase()),
      PROFILE_WALLET,
    );
  });
});

describe("toTrackedAsset", () => {
  it("maps native asset (NULL contract) on Robinhood Chain", () => {
    const asset = toTrackedAsset({
      id: "a1",
      symbol: "ETH",
      name: "Ether",
      chain_id: ROBINHOOD_CHAIN_ID,
      contract_address: null,
      decimals: 18,
      display_order: 0,
      is_tracked: true,
    });
    assert.equal(asset.isNative, true);
    assert.equal(asset.contractAddress, null);
    assert.equal(asset.chainId, 4663);
  });

  it("normalizes ERC-20 contract addresses", () => {
    const asset = toTrackedAsset({
      id: "a2",
      symbol: "USDC",
      name: null,
      chain_id: ROBINHOOD_CHAIN_ID,
      contract_address: "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD",
      decimals: 6,
      display_order: 1,
      is_tracked: true,
    });
    assert.equal(asset.isNative, false);
    assert.equal(
      asset.contractAddress,
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    );
  });

  it("rejects wrong chain ID", () => {
    assert.throws(
      () =>
        toTrackedAsset({
          id: "a3",
          symbol: "ETH",
          name: null,
          chain_id: 1,
          contract_address: null,
          decimals: 18,
          display_order: 0,
          is_tracked: true,
        }),
      (err: unknown) =>
        err instanceof TreasuryError &&
        err.code === "treasury_asset_chain_mismatch",
    );
  });

  it("rejects invalid token address", () => {
    assert.throws(
      () =>
        toTrackedAsset({
          id: "a4",
          symbol: "BAD",
          name: null,
          chain_id: ROBINHOOD_CHAIN_ID,
          contract_address: "0xdead",
          decimals: 18,
          display_order: 0,
          is_tracked: true,
        }),
      (err: unknown) =>
        err instanceof TreasuryError &&
        err.code === "treasury_invalid_token_address",
    );
  });
});

describe("Treasury numeric safety", () => {
  it("preserves bigint beyond Number.MAX_SAFE_INTEGER", () => {
    const raw = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(123456789);
    const amount = toTreasuryAmount(raw, 0);
    assert.equal(typeof amount.raw, "bigint");
    assert.equal(amount.raw, raw);
    assert.equal(amount.formatted, raw.toString());
  });

  it("formats high-decimal tokens without float math", () => {
    const raw = BigInt("123456789012345678901234567");
    const amount = toTreasuryAmount(raw, 18);
    assert.equal(amount.raw, raw);
    assert.equal(amount.formatted, "123456789.012345678901234567");
    assert.equal(parseTokenAmountToRaw(amount.formatted, 18), raw);
  });
});

describe("chain balance primitives", () => {
  it("readNativeBalance preserves bigint", async () => {
    const { readNativeBalance } = await import("./chain");
    const raw = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(99);
    const amount = await readNativeBalance(PROFILE_WALLET, {
      async getBalance(args: { address: string }) {
        assert.equal(args.address, PROFILE_WALLET);
        return raw;
      },
    } as never);
    assert.equal(amount.raw, raw);
    assert.equal(amount.decimals, 18);
  });

  it("readErc20Balance calls balanceOf with holder and token", async () => {
    const { readErc20Balance } = await import("./chain");
    const token = "0x2222222222222222222222222222222222222222";
    const raw = BigInt(1_000_000);
    const amount = await readErc20Balance({
      tokenAddress: token,
      holder: PROFILE_WALLET,
      decimals: 6,
      client: {
        async readContract(args: {
          address: string;
          functionName: string;
          args: string[];
        }) {
          assert.equal(args.address, token);
          assert.equal(args.functionName, "balanceOf");
          assert.deepEqual(args.args, [PROFILE_WALLET]);
          return raw;
        },
      } as never,
    });
    assert.equal(amount.raw, raw);
    assert.equal(amount.formatted, "1");
  });

  it("createRobinhoodPublicClient fails closed without RPC URL", async () => {
    const { createRobinhoodPublicClient } = await import("./chain");
    assert.throws(
      () => createRobinhoodPublicClient(""),
      (err: unknown) =>
        err instanceof TreasuryError && err.code === "treasury_rpc_unavailable",
    );
  });
});

describe("public contribution DTO", () => {
  it("excludes notes and rejects unverified rows", () => {
    assert.throws(() =>
      toPublicTreasuryContribution({
        id: "c1",
        asset_symbol: "ETH",
        amount: "1.5",
        amount_raw: null,
        value_usd_at_receipt: null,
        tx_hash: null,
        from_address: null,
        project_name: null,
        purpose: null,
        designation: "treasury",
        verified: false,
        verified_at: null,
        created_at: "2026-07-01T00:00:00.000Z",
        notes: "secret",
      }),
    );

    const pub = toPublicTreasuryContribution({
      id: "c1",
      asset_symbol: "ETH",
      amount: "1.5",
      amount_raw: "1500000000000000000",
      value_usd_at_receipt: "10.00",
      tx_hash: "0xabc",
      from_address: PROFILE_WALLET,
      project_name: "partner",
      purpose: "grant",
      designation: "treasury",
      verified: true,
      verified_at: "2026-07-02T00:00:00.000Z",
      created_at: "2026-07-01T00:00:00.000Z",
      notes: "secret",
    });
    assert.equal(pub.amount, "1.5");
    assert.equal("notes" in pub, false);
  });
});

describe("treasury source safety", () => {
  it("chain module is read-only", () => {
    const source = readFileSync(join(here, "chain.ts"), "utf8");
    assert.match(source, /createPublicClient/);
    assert.match(source, /getBalance/);
    assert.match(source, /balanceOf/);
    assert.doesNotMatch(source, /sendTransaction|writeContract|privateKey|mnemonic/i);
    assert.doesNotMatch(source, /NEXT_PUBLIC_.*RPC/);
  });

  it("does not import circulations or add balance columns", () => {
    for (const file of [
      "config.ts",
      "assets.ts",
      "chain.ts",
      "types.ts",
      "index.ts",
      "snapshot.ts",
      "contributions-query.ts",
    ]) {
      const source = readFileSync(join(here, file), "utf8");
      assert.doesNotMatch(source, /circulations|circulation_recipients/);
      assert.doesNotMatch(source, /from ["']@\/lib\/circulation/);
      assert.doesNotMatch(source, /balance_raw|cached_balance|last_balance/);
    }
  });
});
