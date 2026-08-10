/**
 * P0 — launch:fund-purse ceremony tests (mocks only; no live chain).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

import {
  FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
  FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
  FENN_TREASURY_PRIVATE_KEY_ENV,
} from "@/lib/ops/fenn-launch-fund-constants";
import {
  formatFennLaunchFundReport,
  formatFennLaunchFundSpeech,
  runFennLaunchFundPurse,
  type FennLaunchFundDeps,
} from "@/lib/ops/fenn-launch-fund-purse";
import {
  LaunchFundSignerError,
  resolveTreasuryLaunchSigningAccount,
} from "@/lib/ops/fenn-launch-treasury-key";
import { readLaunchPurseFunding } from "@/lib/agent/public-fact-readers";
import type { FennLaunchOperationRow } from "@/lib/ops/fenn-launch-fund-store";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { parseTokenAmountToRaw } from "@/lib/treasury/amounts";

const repo = process.cwd();

/** Fixed test key → known address via viem. */
const TEST_TREASURY_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_TREASURY = privateKeyToAccount(TEST_TREASURY_KEY).address.toLowerCase();
const TEST_PURSE = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TEST_TOKEN = "0xcccccccccccccccccccccccccccccccccccccccc";
const TEST_TX =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

const TEN_M_RAW = parseTokenAmountToRaw(
  FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
  18,
);

function baseOp(
  over: Partial<FennLaunchOperationRow> = {},
): FennLaunchOperationRow {
  const now = new Date().toISOString();
  return {
    id: "op-uuid-1",
    operationId: FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
    status: "pending",
    chainId: ROBINHOOD_CHAIN_ID,
    tokenContract: TEST_TOKEN,
    treasuryAddress: TEST_TREASURY,
    purseAddress: TEST_PURSE,
    amountRaw: TEN_M_RAW.toString(),
    decimals: 18,
    amountFormatted: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
    txHash: null,
    blockNumber: null,
    failureClass: null,
    lastError: null,
    submittedAt: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function happyPreflightDeps(
  over: Partial<FennLaunchFundDeps> = {},
): FennLaunchFundDeps {
  let stored: FennLaunchOperationRow | null = null;
  let broadcasts = 0;

  const defaults: FennLaunchFundDeps = {
    getTreasuryConfig: async () => ({
      configured: true as const,
      walletAddress: TEST_TREASURY,
    }),
    getPurseConfig: async () => ({
      configured: true as const,
      walletAddress: TEST_PURSE,
      isEnabled: true,
      officialSettlementActivatedAt: "2026-08-01T00:00:00.000Z",
      economicSettlementEnabled: true,
    }),
    getOfficialToken: async () => ({
      symbol: "FENN",
      name: "FENN",
      chainId: ROBINHOOD_CHAIN_ID,
      contractAddress: TEST_TOKEN,
      decimals: 18,
    }),
    createClient: () => ({}) as never,
    getBytecode: async () => "0x6001600055",
    readTokenMeta: async () => ({
      decimals: 18,
      symbol: "FENN",
      name: "FENN",
    }),
    readNative: async () => ({
      raw: BigInt("1000000000000000000"),
      formatted: "1",
      decimals: 18,
    }),
    readErc20: async () => ({
      raw: TEN_M_RAW * BigInt(2),
      formatted: "20000000",
      decimals: 18,
    }),
    estimateGasCostWei: async () => BigInt(21_000) * BigInt(1_000_000_000),
    resolveSigner: (addr) => {
      const { address } = resolveTreasuryLaunchSigningAccount(
        addr,
        TEST_TREASURY_KEY,
      );
      return { account: { address }, address };
    },
    getOperation: async () => stored,
    insertPending: async (input) => {
      if (stored) {
        return { created: false, row: stored };
      }
      stored = baseOp({
        tokenContract: input.tokenContract,
        treasuryAddress: input.treasuryAddress,
        purseAddress: input.purseAddress,
        amountRaw: input.amountRaw,
        decimals: input.decimals,
        chainId: input.chainId,
        status: "pending",
      });
      return { created: true, row: stored };
    },
    markSubmitted: async (input) => {
      stored = baseOp({
        ...stored!,
        status: "submitted",
        txHash: input.txHash,
        submittedAt: input.submittedAt,
      });
      return stored;
    },
    markConfirmed: async (input) => {
      stored = baseOp({
        ...stored!,
        status: "confirmed",
        txHash: input.txHash,
        confirmedAt: input.confirmedAt,
        blockNumber: input.blockNumber,
        submittedAt: input.submittedAt ?? stored!.submittedAt,
      });
      return stored;
    },
    markFailed: async (input) => {
      stored = baseOp({
        ...stored!,
        status: input.status ?? "failed",
        failureClass: input.failureClass,
        lastError: input.lastError,
        txHash: input.txHash !== undefined ? input.txHash : stored!.txHash,
      });
      return stored;
    },
    broadcast: async (input) => {
      broadcasts += 1;
      assert.equal(input.recipientAddress, TEST_PURSE);
      assert.equal(input.tokenAddress, TEST_TOKEN);
      assert.equal(input.treasuryAddress, TEST_TREASURY);
      assert.equal(input.amountRaw, TEN_M_RAW);
      return { kind: "submitted", txHash: TEST_TX };
    },
    waitReceipt: async () => ({ kind: "success", blockNumber: BigInt(99) }),
    getReceipt: async () => ({ kind: "success", blockNumber: BigInt(99) }),
    privateKeyEnv: TEST_TREASURY_KEY,
    now: () => new Date("2026-08-10T12:00:00.000Z"),
  };

  const deps = { ...defaults, ...over };
  // Preserve closure-backed helpers when overriders replace getOperation alone.
  if (!over.getOperation) {
    deps.getOperation = async () => stored;
  }
  if (!over.insertPending) {
    deps.insertPending = defaults.insertPending;
  }
  (deps as { __broadcasts?: () => number }).__broadcasts = () => broadcasts;
  return deps;
}

describe("P0 treasury launch signer", () => {
  it("missing key refuses", () => {
    assert.throws(
      () => resolveTreasuryLaunchSigningAccount(TEST_TREASURY, ""),
      (e: unknown) =>
        e instanceof LaunchFundSignerError && e.code === "treasury_key_missing",
    );
  });

  it("invalid key refuses", () => {
    assert.throws(
      () => resolveTreasuryLaunchSigningAccount(TEST_TREASURY, "0xdead"),
      (e: unknown) =>
        e instanceof LaunchFundSignerError && e.code === "treasury_key_invalid",
    );
  });

  it("signer/address mismatch refuses", () => {
    assert.throws(
      () =>
        resolveTreasuryLaunchSigningAccount(
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          TEST_TREASURY_KEY,
        ),
      (e: unknown) =>
        e instanceof LaunchFundSignerError &&
        e.code === "treasury_key_address_mismatch",
    );
  });

  it("matching key derives expected treasury", () => {
    const { address } = resolveTreasuryLaunchSigningAccount(
      TEST_TREASURY,
      TEST_TREASURY_KEY,
    );
    assert.equal(address, TEST_TREASURY);
  });
});

describe("P0 source safety — Treasury key boundary", () => {
  it("never imports treasury private key into agent runtime", () => {
    const agentRoot = join(repo, "src/lib/agent");
    const forbidden = [
      "FENN_TREASURY_PRIVATE_KEY",
      "fenn-launch-treasury-signer",
      "broadcastTreasuryErc20Transfer",
      "resolveTreasuryLaunchSigningAccount",
    ];
    // Scan a representative set of agent entry surfaces
    const files = [
      "stage12-contract.ts",
      "stage126-execute.ts",
      "stage124-live-adapters.ts",
      "stage125-authorize.ts",
      "stage124-sight.ts",
    ];
    for (const f of files) {
      const path = join(agentRoot, f);
      if (!existsSync(path)) continue;
      const body = readFileSync(path, "utf8");
      for (const needle of forbidden) {
        assert.doesNotMatch(
          body,
          new RegExp(needle),
          `${f} must not reference ${needle}`,
        );
      }
    }
  });

  it("ops fund path does not log the private key", () => {
    const fund = readFileSync(
      join(repo, "src/lib/ops/fenn-launch-fund-purse.ts"),
      "utf8",
    );
    const signer = readFileSync(
      join(repo, "src/lib/ops/fenn-launch-treasury-signer.ts"),
      "utf8",
    );
    const cli = readFileSync(
      join(repo, "scripts/fenn-launch-fund-purse.ts"),
      "utf8",
    );
    for (const body of [fund, signer, cli]) {
      assert.doesNotMatch(body, /console\.(log|info|debug|error).*privateKey/i);
      assert.doesNotMatch(body, /console\.(log|info|debug|error).*PRIVATE_KEY/);
    }
  });

  it("env example documents local-only treasury key", () => {
    const env = readFileSync(join(repo, ".env.example"), "utf8");
    assert.match(env, /FENN_TREASURY_PRIVATE_KEY/);
    assert.match(env, /launch-operator|local|operator/i);
    assert.doesNotMatch(env, /NEXT_PUBLIC_FENN_TREASURY_PRIVATE_KEY/);
  });

  it("x agent and purse executor env lists omit treasury private key", () => {
    const x = readFileSync(join(repo, "src/lib/ops/x-runtime-env.ts"), "utf8");
    const purse = readFileSync(
      join(repo, "src/lib/ops/purse-executor-env.ts"),
      "utf8",
    );
    assert.doesNotMatch(x, /FENN_TREASURY_PRIVATE_KEY/);
    assert.doesNotMatch(purse, /FENN_TREASURY_PRIVATE_KEY/);
  });
});

describe("P0 preflight refuse", () => {
  it("wrong chain refuses", async () => {
    const deps = happyPreflightDeps({
      getOfficialToken: async () => ({
        symbol: "FENN",
        name: "FENN",
        chainId: 1,
        contractAddress: TEST_TOKEN,
        decimals: 18,
      }),
    });
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.errorCode, "wrong_chain");
    assert.equal(r.chainBroadcastAttempted, false);
  });

  it("no official contract refuses", async () => {
    const deps = happyPreflightDeps({
      getOfficialToken: async () => null,
    });
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.errorCode, "official_fenn_unavailable");
  });

  it("null/malformed contract refuses", async () => {
    const deps = happyPreflightDeps({
      getOfficialToken: async () => ({
        symbol: "FENN",
        name: "FENN",
        chainId: ROBINHOOD_CHAIN_ID,
        contractAddress: "not-an-address",
        decimals: 18,
      }),
    });
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.errorCode, "malformed_address");
    assert.equal(r.chainBroadcastAttempted, false);
  });

  it("wrong on-chain decimals refuses", async () => {
    const deps = happyPreflightDeps({
      readTokenMeta: async () => ({
        decimals: 6,
        symbol: "FENN",
        name: "FENN",
      }),
    });
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.errorCode, "onchain_decimals_mismatch");
  });

  it("wrong on-chain symbol refuses", async () => {
    const deps = happyPreflightDeps({
      readTokenMeta: async () => ({
        decimals: 18,
        symbol: "USDC",
        name: "USD Coin",
      }),
    });
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.errorCode, "onchain_symbol_mismatch");
  });

  it("insufficient treasury FENN refuses", async () => {
    const deps = happyPreflightDeps({
      readErc20: async () => ({
        raw: BigInt(1),
        formatted: "0.000000000000000001",
        decimals: 18,
      }),
    });
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.errorCode, "insufficient_treasury_fenn");
  });

  it("treasury equals purse refuses", async () => {
    const deps = happyPreflightDeps({
      getPurseConfig: async () => ({
        configured: true as const,
        walletAddress: TEST_TREASURY,
        isEnabled: true,
        officialSettlementActivatedAt: null,
        economicSettlementEnabled: true,
      }),
    });
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.errorCode, "treasury_purse_same_address");
  });

  it("signer mismatch refuses before broadcast", async () => {
    const deps = happyPreflightDeps({
      resolveSigner: () => {
        throw new LaunchFundSignerError(
          "treasury_key_address_mismatch",
          "mismatch",
        );
      },
    });
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.errorCode, "treasury_key_address_mismatch");
    assert.equal(r.chainBroadcastAttempted, false);
  });
});

describe("P0 transaction + idempotency", () => {
  it("first eligible run broadcasts exact 10m to canonical purse once", async () => {
    const deps = happyPreflightDeps();
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "CONFIRMED");
    assert.equal(r.amountFormatted, "10000000");
    assert.equal(r.tokenContract, TEST_TOKEN);
    assert.equal(r.purseAddress, TEST_PURSE);
    assert.equal(r.treasuryAddress, TEST_TREASURY);
    assert.equal(r.txHash, TEST_TX);
    assert.equal(r.chainBroadcastAttempted, true);
    assert.match(r.explorerUrl ?? "", /blockscout\.com\/tx\//);
    const b = (
      deps as { __broadcasts: () => number }
    ).__broadcasts();
    assert.equal(b, 1);
  });

  it("confirmed operation never broadcasts again", async () => {
    const deps = happyPreflightDeps({
      getOperation: async () =>
        baseOp({
          status: "confirmed",
          txHash: TEST_TX,
          confirmedAt: "2026-08-10T11:00:00.000Z",
          blockNumber: "42",
        }),
    });
    let broadcasts = 0;
    deps.broadcast = async () => {
      broadcasts += 1;
      return { kind: "submitted", txHash: TEST_TX };
    };
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "ALREADY_CONFIRMED");
    assert.equal(broadcasts, 0);
    assert.equal(r.chainBroadcastAttempted, false);
    const text = formatFennLaunchFundReport(r);
    assert.match(text, /NO ACTION TAKEN/);
    assert.match(text, /10,000,000 FENN have left the Treasury/);
  });

  it("submitted operation reconciles and never rebroadcasts", async () => {
    const deps = happyPreflightDeps({
      getOperation: async () =>
        baseOp({
          status: "submitted",
          txHash: TEST_TX,
          submittedAt: "2026-08-10T11:00:00.000Z",
        }),
    });
    let broadcasts = 0;
    deps.broadcast = async () => {
      broadcasts += 1;
      return { kind: "submitted", txHash: "0x2222222222222222222222222222222222222222222222222222222222222222" };
    };
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "RECONCILED_CONFIRMED");
    assert.equal(broadcasts, 0);
    assert.equal(r.txHash, TEST_TX);
  });

  it("ambiguous operation never rebroadcasts", async () => {
    const deps = happyPreflightDeps({
      getOperation: async () =>
        baseOp({
          status: "ambiguous",
          txHash: TEST_TX,
          failureClass: "ambiguous",
          lastError: "timeout",
        }),
      getReceipt: async () => ({ kind: "missing" }),
    });
    let broadcasts = 0;
    deps.broadcast = async () => {
      broadcasts += 1;
      return { kind: "submitted", txHash: TEST_TX };
    };
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "AMBIGUOUS");
    assert.equal(broadcasts, 0);
  });

  it("concurrent pending claim does not broadcast twice", async () => {
    const deps = happyPreflightDeps({
      getOperation: async () => null,
      insertPending: async () => ({
        created: false,
        row: baseOp({ status: "pending" }),
      }),
    });
    let broadcasts = 0;
    deps.broadcast = async () => {
      broadcasts += 1;
      return { kind: "submitted", txHash: TEST_TX };
    };
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.errorCode, "pending_already_claimed");
    assert.equal(broadcasts, 0);
  });

  it("future purse balance below 10m does not allow second fund", async () => {
    // Historical confirmation is authority — balances ignore.
    const deps = happyPreflightDeps({
      getOperation: async () =>
        baseOp({
          status: "confirmed",
          txHash: TEST_TX,
          confirmedAt: "2026-08-09T00:00:00.000Z",
        }),
      readErc20: async () => ({
        raw: BigInt(0),
        formatted: "0",
        decimals: 18,
      }),
    });
    let broadcasts = 0;
    deps.broadcast = async () => {
      broadcasts += 1;
      return { kind: "submitted", txHash: TEST_TX };
    };
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "ALREADY_CONFIRMED");
    assert.equal(broadcasts, 0);
  });

  it("reverted receipt fails and does not rebroadcast in-run", async () => {
    const deps = happyPreflightDeps({
      waitReceipt: async () => ({ kind: "reverted", blockNumber: BigInt(1) }),
    });
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "FAILED");
    assert.equal(r.errorCode, "transaction_reverted");
    assert.equal(r.chainBroadcastAttempted, true);
  });

  it("receipt timeout becomes ambiguous without second transfer", async () => {
    const deps = happyPreflightDeps({
      waitReceipt: async () => ({
        kind: "unknown",
        error: "timeout waiting for confirmation",
      }),
    });
    let broadcasts = 0;
    deps.broadcast = async (input) => {
      broadcasts += 1;
      assert.equal(input.amountRaw, TEN_M_RAW);
      return { kind: "submitted", txHash: TEST_TX };
    };
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.status, "AMBIGUOUS");
    assert.equal(broadcasts, 1);
  });

  it("existing pending at start refuses", async () => {
    const deps = happyPreflightDeps({
      getOperation: async () => baseOp({ status: "pending" }),
    });
    let broadcasts = 0;
    deps.broadcast = async () => {
      broadcasts += 1;
      return { kind: "submitted", txHash: TEST_TX };
    };
    const r = await runFennLaunchFundPurse(deps);
    assert.equal(r.errorCode, "pending_already_claimed");
    assert.equal(broadcasts, 0);
  });
});

describe("P0 knowledge fact fenn_launch_purse_funding", () => {
  it("unconfirmed does not expose funding fact", async () => {
    const fact = await readLaunchPurseFunding({
      loadOperation: async () => ({
        status: "submitted",
        amountFormatted: "10000000",
        treasuryAddress: TEST_TREASURY,
        purseAddress: TEST_PURSE,
        tokenContract: TEST_TOKEN,
        chainId: ROBINHOOD_CHAIN_ID,
        txHash: TEST_TX,
        confirmedAt: null,
        blockNumber: null,
      }),
    });
    assert.equal(fact.available, false);
    assert.equal(fact.key, "fenn_launch_purse_funding");
  });

  it("confirmed exposes trusted fact with explorer from hash", async () => {
    const fact = await readLaunchPurseFunding({
      loadOperation: async () => ({
        status: "confirmed",
        amountFormatted: "10000000",
        treasuryAddress: TEST_TREASURY,
        purseAddress: TEST_PURSE,
        tokenContract: TEST_TOKEN,
        chainId: ROBINHOOD_CHAIN_ID,
        txHash: TEST_TX,
        confirmedAt: "2026-08-10T12:00:00.000Z",
        blockNumber: "99",
      }),
    });
    assert.equal(fact.available, true);
    assert.match(fact.detail ?? "", /10,000,000 FENN/);
    assert.match(fact.detail ?? "", new RegExp(TEST_TX));
    assert.match(fact.detail ?? "", /blockscout\.com\/tx\//);
    assert.match(fact.detail ?? "", new RegExp(TEST_TREASURY));
    assert.match(fact.detail ?? "", new RegExp(TEST_PURSE));
  });
});

describe("P0 speech + package/scripts", () => {
  it("launch speech is deterministic", () => {
    const speech = formatFennLaunchFundSpeech(
      "https://robinhoodchain.blockscout.com/tx/0xabc",
    );
    assert.match(speech, /10,000,000 FENN have left the Treasury/);
    assert.match(speech, /They are in my Purse now/);
    assert.match(speech, /the means to act/);
    assert.match(speech, /blockscout\.com/);
  });

  it("package.json exposes launch:fund-purse", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    assert.match(pkg.scripts["launch:fund-purse"], /fenn-launch-fund-purse/);
  });

  it("migration exists with uniqueness constraints", () => {
    const mig = join(
      repo,
      "supabase/migrations/20260810140000_63_fenn_launch_purse_funding.sql",
    );
    assert.equal(existsSync(mig), true);
    const sql = readFileSync(mig, "utf8");
    assert.match(sql, /fenn_launch_operations/);
    assert.match(sql, /fenn_launch_operations_operation_id_uidx/);
    assert.match(sql, /fenn_launch_operations_tx_hash_uidx/);
    assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.purse_transfers/i);
    assert.match(sql, /Not purse_transfers/i);
  });
});

// silence env name export check
void FENN_TREASURY_PRIVATE_KEY_ENV;
