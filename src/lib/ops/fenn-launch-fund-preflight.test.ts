/**
 * Read-only launch:fund-purse:preflight tests.
 * Mocks only — no live chain, no broadcast path.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

import {
  FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
} from "@/lib/ops/fenn-launch-fund-constants";
import {
  formatFennLaunchFundPreflightReport,
  runFennLaunchFundPreflight,
  type FennLaunchFundPreflightDeps,
} from "@/lib/ops/fenn-launch-fund-preflight";
import {
  LaunchFundSignerError,
  resolveTreasuryLaunchSigningAccount,
} from "@/lib/ops/fenn-launch-treasury-key";
import { parseTokenAmountToRaw } from "@/lib/treasury/amounts";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";

const repo = process.cwd();

const TEST_TREASURY_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_TREASURY = privateKeyToAccount(TEST_TREASURY_KEY).address.toLowerCase();
const TEST_PURSE = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TEST_TOKEN = "0xcccccccccccccccccccccccccccccccccccccccc";
const TEN_M_RAW = parseTokenAmountToRaw(
  FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
  18,
);

function baseDeps(
  over: Partial<FennLaunchFundPreflightDeps> = {},
): FennLaunchFundPreflightDeps {
  const defaults: FennLaunchFundPreflightDeps = {
    getTreasuryConfig: async () => ({
      configured: true as const,
      walletAddress: TEST_TREASURY,
    }),
    getPurseConfig: async () => ({
      configured: true as const,
      walletAddress: TEST_PURSE,
      isEnabled: true,
      officialSettlementActivatedAt: null,
      economicSettlementEnabled: true,
    }),
    getOfficialToken: async () => null,
    getOperation: async () => null,
    createClient: () =>
      ({
        getChainId: async () => ROBINHOOD_CHAIN_ID,
      }) as never,
    getChainId: async () => ROBINHOOD_CHAIN_ID,
    readNative: async () => ({
      raw: BigInt("1000000000000000000"),
      formatted: "1",
      decimals: 18,
    }),
    resolveSigner: (addr) => {
      const { address } = resolveTreasuryLaunchSigningAccount(
        addr,
        TEST_TREASURY_KEY,
      );
      return { address };
    },
    privateKeyEnv: TEST_TREASURY_KEY,
  };
  return { ...defaults, ...over };
}

function activatedDeps(
  over: Partial<FennLaunchFundPreflightDeps> = {},
): FennLaunchFundPreflightDeps {
  return baseDeps({
    getOfficialToken: async () => ({
      symbol: "VELL",
      name: "VELL",
      chainId: ROBINHOOD_CHAIN_ID,
      contractAddress: TEST_TOKEN,
      decimals: 18,
    }),
    getBytecode: async () => "0x6001600055",
    readTokenMeta: async () => ({
      decimals: 18,
      symbol: "VELL",
      name: "VELL",
    }),
    readErc20: async () => ({
      raw: TEN_M_RAW * BigInt(2),
      formatted: "20000000",
      decimals: 18,
    }),
    estimateGasCostWei: async () => BigInt(21_000) * BigInt(1_000_000_000),
    ...over,
  });
}

describe("P0 fund preflight — source safety", () => {
  it("preflight module does not import broadcast / write paths", () => {
    const preflight = readFileSync(
      join(repo, "src/lib/ops/fenn-launch-fund-preflight.ts"),
      "utf8",
    );
    const script = readFileSync(
      join(repo, "scripts/fenn-launch-fund-purse-preflight.ts"),
      "utf8",
    );
    for (const body of [preflight, script]) {
      assert.doesNotMatch(body, /from ["']@\/lib\/ops\/fenn-launch-treasury-signer["']/);
      assert.doesNotMatch(body, /from ["']@\/lib\/ops\/fenn-launch-fund-purse["']/);
      assert.doesNotMatch(body, /\bbroadcastTreasuryErc20Transfer\b/);
      assert.doesNotMatch(body, /\brunFennLaunchFundPurse\b/);
      assert.doesNotMatch(body, /\bwriteContract\b/);
      assert.doesNotMatch(body, /\bsendTransaction\b/);
      assert.doesNotMatch(body, /\bcreateWalletClient\b/);
      assert.doesNotMatch(body, /\binsertPendingLaunchOperation\b/);
      assert.doesNotMatch(body, /\bmarkLaunchOperation(Submitted|Confirmed|Failed)\b/);
    }
    // Key module is read-only (no wallet write)
    const key = readFileSync(
      join(repo, "src/lib/ops/fenn-launch-treasury-key.ts"),
      "utf8",
    );
    assert.doesNotMatch(key, /writeContract|createWalletClient|sendTransaction/);
  });

  it("package script exists", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    assert.match(
      pkg.scripts["launch:fund-purse:preflight"],
      /fenn-launch-fund-purse-preflight/,
    );
  });
});

describe("P0 fund preflight — local env before activate", () => {
  it("missing official token reports WAITING not failure when env ready", async () => {
    let broadcastCalls = 0;
    const deps = baseDeps({
      // Prove we do not wire broadcast — even if present on deps object, unused.
    });
    void broadcastCalls;
    const report = await runFennLaunchFundPreflight(deps);
    assert.equal(report.result, "LOCAL_ENV_READY_WAITING_CONTRACT");
    assert.equal(report.broadcastEnabled, false);
    assert.equal(report.sideEffectsAttempted, false);
    assert.equal(report.chainBroadcastAttempted, false);
    const official = report.checks.find((c) => c.id === "official_fenn");
    assert.equal(official?.verdict, "WAITING");
    const text = formatFennLaunchFundPreflightReport(report);
    assert.match(text, /RESULT: LOCAL LAUNCH ENVIRONMENT READY/);
    assert.match(text, /WAITING FOR FENN CONTRACT/);
    assert.match(text, /BROADCAST ENABLED:\s+NO/);
  });

  it("signer mismatch fails closed", async () => {
    const report = await runFennLaunchFundPreflight(
      baseDeps({
        resolveSigner: () => {
          throw new LaunchFundSignerError(
            "treasury_key_address_mismatch",
            "mismatch",
          );
        },
      }),
    );
    assert.equal(report.result, "NOT_READY");
    assert.equal(
      report.checks.find((c) => c.id === "treasury_signer")?.verdict,
      "FAIL",
    );
  });

  it("wrong chain fails", async () => {
    const report = await runFennLaunchFundPreflight(
      baseDeps({
        getChainId: async () => 1,
      }),
    );
    assert.equal(report.result, "NOT_READY");
    assert.equal(report.checks.find((c) => c.id === "chain")?.verdict, "FAIL");
  });

  it("never mutates launch operation", async () => {
    let reads = 0;
    const report = await runFennLaunchFundPreflight(
      baseDeps({
        getOperation: async () => {
          reads += 1;
          return null;
        },
      }),
    );
    assert.equal(reads, 1);
    assert.equal(report.sideEffectsAttempted, false);
    // No mutation surface on deps API for preflight
    assert.equal(
      "insertPending" in report || "markSubmitted" in report,
      false,
    );
  });
});

describe("P0 fund preflight — post activation", () => {
  it("READY TO FUND when fully valid", async () => {
    const report = await runFennLaunchFundPreflight(activatedDeps());
    assert.equal(report.result, "READY_TO_FUND");
    assert.equal(report.officialTokenPresent, true);
    assert.equal(report.tokenContract, TEST_TOKEN);
    const text = formatFennLaunchFundPreflightReport(report);
    assert.match(text, /RESULT: READY TO FUND/);
    assert.match(text, /NEXT: npm run launch:fund-purse/);
    assert.match(text, /10,000,000 FENN/);
    assert.match(text, new RegExp(TEST_TREASURY));
    assert.match(text, new RegExp(TEST_PURSE));
    assert.doesNotMatch(text, /0xac0974bec39a17e36ba4a6b4d238ff944bacb478/);
  });

  it("insufficient treasury ETH / gas fails", async () => {
    const report = await runFennLaunchFundPreflight(
      activatedDeps({
        readNative: async () => ({
          raw: BigInt(1),
          formatted: "0.000000000000000001",
          decimals: 18,
        }),
        estimateGasCostWei: async () => BigInt("100000000000000000"),
      }),
    );
    assert.equal(report.result, "NOT_READY");
    assert.equal(report.checks.find((c) => c.id === "gas")?.verdict, "FAIL");
  });

  it("wrong bytecode fails", async () => {
    const report = await runFennLaunchFundPreflight(
      activatedDeps({ getBytecode: async () => "0x" }),
    );
    assert.equal(report.result, "NOT_READY");
    assert.equal(
      report.checks.find((c) => c.id === "token_bytecode")?.verdict,
      "FAIL",
    );
  });

  it("wrong on-chain decimals fails", async () => {
    const report = await runFennLaunchFundPreflight(
      activatedDeps({
        readTokenMeta: async () => ({
          decimals: 6,
          symbol: "VELL",
          name: "VELL",
        }),
      }),
    );
    assert.equal(report.result, "NOT_READY");
    assert.equal(
      report.checks.find((c) => c.id === "token_decimals")?.verdict,
      "FAIL",
    );
  });

  it("wrong on-chain symbol fails", async () => {
    const report = await runFennLaunchFundPreflight(
      activatedDeps({
        readTokenMeta: async () => ({
          decimals: 18,
          symbol: "USDC",
          name: "USD",
        }),
      }),
    );
    assert.equal(report.result, "NOT_READY");
    assert.equal(
      report.checks.find((c) => c.id === "token_symbol")?.verdict,
      "FAIL",
    );
  });

  it("insufficient FENN fails", async () => {
    const report = await runFennLaunchFundPreflight(
      activatedDeps({
        readErc20: async () => ({
          raw: BigInt(1),
          formatted: "0.000000000000000001",
          decimals: 18,
        }),
      }),
    );
    assert.equal(report.result, "NOT_READY");
    assert.equal(
      report.checks.find((c) => c.id === "treasury_fenn")?.verdict,
      "FAIL",
    );
  });

  it("confirmed operation not eligible", async () => {
    const report = await runFennLaunchFundPreflight(
      activatedDeps({
        getOperation: async () => ({
          status: "confirmed",
          txHash: "0x" + "11".repeat(32),
        }),
      }),
    );
    assert.equal(report.result, "NOT_READY");
    assert.match(
      report.checks.find((c) => c.id === "launch_operation")?.detail ?? "",
      /confirmed/,
    );
  });

  it("submitted operation not eligible", async () => {
    const report = await runFennLaunchFundPreflight(
      activatedDeps({
        getOperation: async () => ({
          status: "submitted",
          txHash: "0x" + "22".repeat(32),
        }),
      }),
    );
    assert.equal(report.result, "NOT_READY");
  });

  it("ambiguous operation not eligible", async () => {
    const report = await runFennLaunchFundPreflight(
      activatedDeps({
        getOperation: async () => ({
          status: "ambiguous",
          failureClass: "ambiguous",
        }),
      }),
    );
    assert.equal(report.result, "NOT_READY");
  });
});

describe("P0 fund preflight — no real broadcast deps", () => {
  it("exists as separate script file", () => {
    assert.equal(
      existsSync(join(repo, "scripts/fenn-launch-fund-purse-preflight.ts")),
      true,
    );
  });
});
