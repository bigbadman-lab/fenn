import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
} from "@/lib/purse/constants";
import { PurseError } from "@/lib/purse/errors";
import {
  assertNotNativeTransfer,
  assertOfficialFennTokenOnly,
  assertP0ManualAmount,
  assertRobinhoodChainId,
  mayRetryBroadcast,
  parseOperationId,
  parsePurseRecipient,
  shouldReconcileExistingTx,
} from "@/lib/purse/policy";
import { executeManualOneFennTransfer } from "@/lib/purse/transfer";
import { getPublicPurseSnapshot } from "@/lib/purse/snapshot";
import type { ManualTransferDeps } from "@/lib/purse/transfer";
import type { PurseTransferRow } from "@/lib/purse/types";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import type { OfficialFennTokenAsset } from "@/lib/treasury/types";

const OFFICIAL: OfficialFennTokenAsset = {
  symbol: "FENN",
  name: "FENN",
  chainId: ROBINHOOD_CHAIN_ID,
  contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  decimals: 18,
};

const PURSE = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const RECIPIENT = "0xcccccccccccccccccccccccccccccccccccccccc";
const OTHER_TOKEN = "0xdddddddddddddddddddddddddddddddddddddddd";

function baseRow(over: Partial<PurseTransferRow> = {}): PurseTransferRow {
  return {
    id: "xfer-1",
    operationId: "op-1",
    recipientAddress: RECIPIENT,
    amountRaw: "1000000000000000000",
    amountFormatted: "1",
    tokenAddress: OFFICIAL.contractAddress,
    chainId: ROBINHOOD_CHAIN_ID,
    txHash: null,
    status: "pending",
    failureClass: null,
    lastError: null,
    actorId: "ops:test",
    createdAt: "2026-08-08T00:00:00.000Z",
    submittedAt: null,
    confirmedAt: null,
    ...over,
  };
}

function makeDeps(over: Partial<ManualTransferDeps> = {}): ManualTransferDeps {
  const store = new Map<string, PurseTransferRow>();

  const deps: ManualTransferDeps = {
    getPurse: async () => ({ walletAddress: PURSE }),
    getOfficialToken: async () => OFFICIAL,
    acquireLock: async () => true,
    releaseLock: async () => {},
    getByOperationId: async (id) => store.get(id) ?? null,
    insertPending: async (input) => {
      const existing = store.get(input.operationId);
      if (existing) return existing;
      const row = baseRow({
        operationId: input.operationId,
        recipientAddress: input.recipientAddress,
        amountRaw: input.amountRaw,
        amountFormatted: input.amountFormatted,
        tokenAddress: input.tokenAddress,
        chainId: input.chainId,
        actorId: input.actorId,
        status: "pending",
      });
      store.set(input.operationId, row);
      return row;
    },
    markSubmitted: async (input) => {
      const prev = [...store.values()].find((r) => r.id === input.id);
      assert.ok(prev);
      const next = {
        ...prev,
        status: "submitted" as const,
        txHash: input.txHash,
        submittedAt: input.submittedAt,
      };
      store.set(prev.operationId, next);
      return next;
    },
    markConfirmed: async (input) => {
      const prev = [...store.values()].find((r) => r.id === input.id);
      assert.ok(prev);
      const next = {
        ...prev,
        status: "confirmed" as const,
        txHash: input.txHash,
        confirmedAt: input.confirmedAt,
        submittedAt: input.submittedAt ?? prev.submittedAt,
        failureClass: null,
        lastError: null,
      };
      store.set(prev.operationId, next);
      return next;
    },
    markFailed: async (input) => {
      const prev = [...store.values()].find((r) => r.id === input.id);
      assert.ok(prev);
      const status =
        input.status ??
        (input.failureClass === "ambiguous" ? "ambiguous" : "failed");
      const next = {
        ...prev,
        status: status as PurseTransferRow["status"],
        failureClass: input.failureClass,
        lastError: input.lastError,
        txHash: input.txHash ?? prev.txHash,
      };
      store.set(prev.operationId, next);
      return next;
    },
    resetForRetry: async (id) => {
      const prev = [...store.values()].find((r) => r.id === id);
      assert.ok(prev);
      const next = {
        ...prev,
        status: "pending" as const,
        failureClass: null,
        lastError: null,
        txHash: null,
        submittedAt: null,
        confirmedAt: null,
      };
      store.set(prev.operationId, next);
      return next;
    },
    readFennBalance: async () => ({
      raw: BigInt("5000000000000000000"),
      formatted: "5",
      decimals: 18,
    }),
    broadcast: async () => ({
      kind: "submitted" as const,
      txHash:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    }),
    waitReceipt: async () => ({ kind: "success" as const }),
    getReceipt: async () => ({ kind: "success" as const }),
    now: () => new Date("2026-08-08T12:00:00.000Z"),
    ...over,
  };

  // Keep store helpers if insert overridden fully
  return deps;
}

describe("Purse P0 policy", () => {
  it("rejects invalid recipient", () => {
    assert.throws(
      () => parsePurseRecipient("not-an-address"),
      (e: unknown) =>
        e instanceof PurseError && e.code === "purse_invalid_recipient",
    );
  });

  it("rejects wrong chain", () => {
    assert.throws(
      () => assertRobinhoodChainId(1),
      (e: unknown) => e instanceof PurseError && e.code === "purse_wrong_chain",
    );
  });

  it("fails closed without official FENN token", () => {
    assert.throws(
      () => assertOfficialFennTokenOnly(null),
      (e: unknown) =>
        e instanceof PurseError &&
        e.code === "purse_official_token_unavailable",
    );
  });

  it("cannot transfer native token", () => {
    assert.throws(
      () => assertNotNativeTransfer("native"),
      (e: unknown) =>
        e instanceof PurseError &&
        e.code === "purse_native_transfer_forbidden",
    );
  });

  it("cannot transfer arbitrary ERC-20", () => {
    assert.throws(
      () => assertOfficialFennTokenOnly(OFFICIAL, OTHER_TOKEN),
      (e: unknown) =>
        e instanceof PurseError &&
        e.code === "purse_arbitrary_token_forbidden",
    );
  });

  it("amount is fixed to exactly 1 FENN for P0 manual operation", () => {
    assert.equal(assertP0ManualAmount("1"), "1");
    assert.equal(P0_MANUAL_TRANSFER_AMOUNT_FORMATTED, "1");
    assert.throws(
      () => assertP0ManualAmount("2"),
      (e: unknown) =>
        e instanceof PurseError && e.code === "purse_amount_not_fixed",
    );
    assert.throws(() => assertP0ManualAmount("1.0"), PurseError);
  });

  it("operation id validation", () => {
    assert.equal(parseOperationId("p0-test-1"), "p0-test-1");
    assert.throws(() => parseOperationId(" has spaces "), PurseError);
  });

  it("retry and reconcile laws", () => {
    assert.equal(
      mayRetryBroadcast({
        status: "pending",
        failureClass: null,
        txHash: null,
      }),
      true,
    );
    assert.equal(
      mayRetryBroadcast({
        status: "failed",
        failureClass: "pre_broadcast",
        txHash: null,
      }),
      true,
    );
    assert.equal(
      mayRetryBroadcast({
        status: "ambiguous",
        failureClass: "ambiguous",
        txHash: null,
      }),
      false,
    );
    assert.equal(
      mayRetryBroadcast({
        status: "submitted",
        failureClass: null,
        txHash: "0xabc",
      }),
      false,
    );
    assert.equal(
      shouldReconcileExistingTx({
        status: "submitted",
        txHash: "0xabc",
      }),
      true,
    );
    assert.equal(
      shouldReconcileExistingTx({
        status: "confirmed",
        txHash: "0xabc",
      }),
      false,
    );
  });
});

describe("executeManualOneFennTransfer idempotency", () => {
  it("same operation ID cannot create duplicate settlement broadcast", async () => {
    let broadcasts = 0;
    const deps = makeDeps({
      broadcast: async () => {
        broadcasts += 1;
        return {
          kind: "submitted",
          txHash:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
        };
      },
    });

    const first = await executeManualOneFennTransfer(
      { recipientAddress: RECIPIENT, operationId: "op-dup-1" },
      deps,
    );
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.reusedExisting, false);

    const second = await executeManualOneFennTransfer(
      { recipientAddress: RECIPIENT, operationId: "op-dup-1" },
      deps,
    );
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(second.reusedExisting, true);
      assert.equal(
        second.txHash,
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      );
    }
    assert.equal(broadcasts, 1);
  });

  it("confirmed operation returns existing result on repeat", async () => {
    const confirmedHash =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    const store = baseRow({
      operationId: "op-confirmed",
      status: "confirmed",
      txHash: confirmedHash,
      confirmedAt: "2026-08-08T11:00:00.000Z",
      submittedAt: "2026-08-08T10:59:00.000Z",
    });

    const deps = makeDeps({
      getByOperationId: async () => store,
      broadcast: async () => {
        throw new Error("must not broadcast");
      },
    });

    const result = await executeManualOneFennTransfer(
      { recipientAddress: RECIPIENT, operationId: "op-confirmed" },
      deps,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.reusedExisting, true);
      assert.equal(result.txHash, confirmedHash);
    }
  });

  it("known submitted tx reconciles instead of rebroadcasting", async () => {
    let broadcasts = 0;
    const known =
      "0x3333333333333333333333333333333333333333333333333333333333333333";
    let row = baseRow({
      operationId: "op-submitted",
      status: "submitted",
      txHash: known,
      submittedAt: "2026-08-08T11:00:00.000Z",
    });

    const deps = makeDeps({
      getByOperationId: async () => row,
      broadcast: async () => {
        broadcasts += 1;
        return { kind: "submitted", txHash: "0xshouldnot" };
      },
      getReceipt: async () => ({ kind: "success" }),
      markConfirmed: async (input) => {
        row = {
          ...row,
          status: "confirmed",
          txHash: input.txHash,
          confirmedAt: input.confirmedAt,
        };
        return row;
      },
    });

    const result = await executeManualOneFennTransfer(
      { recipientAddress: RECIPIENT, operationId: "op-submitted" },
      deps,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.txHash, known);
    assert.equal(broadcasts, 0);
  });

  it("ambiguous broadcast is not blindly retried", async () => {
    let broadcasts = 0;
    const deps = makeDeps({
      broadcast: async () => {
        broadcasts += 1;
        return { kind: "ambiguous", error: "network timeout after send" };
      },
    });

    const first = await executeManualOneFennTransfer(
      { recipientAddress: RECIPIENT, operationId: "op-amb" },
      deps,
    );
    assert.equal(first.ok, false);
    if (!first.ok) {
      assert.equal(first.code, "purse_ambiguous");
      assert.equal(first.failureClass, "ambiguous");
    }

    const second = await executeManualOneFennTransfer(
      { recipientAddress: RECIPIENT, operationId: "op-amb" },
      deps,
    );
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "purse_ambiguous");
    // Second call must not rebroadcast (no known hash path rebroadcast either).
    assert.equal(broadcasts, 1);
  });

  it("insufficient FENN balance fails safely without broadcast", async () => {
    let broadcasts = 0;
    const deps = makeDeps({
      readFennBalance: async () => ({
        raw: BigInt(0),
        formatted: "0",
        decimals: 18,
      }),
      broadcast: async () => {
        broadcasts += 1;
        return {
          kind: "submitted",
          txHash:
            "0x4444444444444444444444444444444444444444444444444444444444444444",
        };
      },
    });

    const result = await executeManualOneFennTransfer(
      { recipientAddress: RECIPIENT, operationId: "op-empty" },
      deps,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "purse_insufficient_fenn");
    assert.equal(broadcasts, 0);
  });

  it("missing/invalid Purse configuration fails closed", async () => {
    await assert.rejects(
      () =>
        executeManualOneFennTransfer(
          { recipientAddress: RECIPIENT, operationId: "op-cfg" },
          makeDeps({
            getPurse: async () => {
              throw new PurseError(
                "purse_unconfigured",
                "missing",
                503,
              );
            },
          }),
        ),
      (e: unknown) =>
        e instanceof PurseError && e.code === "purse_unconfigured",
    );

    await assert.rejects(
      () =>
        executeManualOneFennTransfer(
          { recipientAddress: RECIPIENT, operationId: "op-token" },
          makeDeps({
            getOfficialToken: async () => null,
          }),
        ),
      (e: unknown) =>
        e instanceof PurseError &&
        e.code === "purse_official_token_unavailable",
    );
  });

  it("pre_broadcast failure may retry with the same operation id", async () => {
    let broadcasts = 0;
    const deps = makeDeps({
      broadcast: async () => {
        broadcasts += 1;
        if (broadcasts === 1) {
          return { kind: "pre_broadcast_failed", error: "rpc_down" };
        }
        return {
          kind: "submitted",
          txHash:
            "0x5555555555555555555555555555555555555555555555555555555555555555",
        };
      },
    });

    const first = await executeManualOneFennTransfer(
      { recipientAddress: RECIPIENT, operationId: "op-retry" },
      deps,
    );
    assert.equal(first.ok, false);
    if (!first.ok) assert.equal(first.failureClass, "pre_broadcast");

    const second = await executeManualOneFennTransfer(
      { recipientAddress: RECIPIENT, operationId: "op-retry" },
      deps,
    );
    assert.equal(second.ok, true);
    assert.equal(broadcasts, 2);
  });
});

describe("public Purse snapshot safety", () => {
  it("private key cannot leak through public readers", async () => {
    process.env.FENN_PURSE_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    const snap = await getPublicPurseSnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: PURSE,
        isEnabled: true,
      }),
      getOfficialToken: async () => OFFICIAL,
      listConfirmed: async () => [
        {
          id: "1",
          operationId: "op-1",
          recipientAddress: RECIPIENT,
          amountFormatted: "1",
          tokenAddress: OFFICIAL.contractAddress,
          chainId: ROBINHOOD_CHAIN_ID,
          txHash:
            "0x6666666666666666666666666666666666666666666666666666666666666666",
          confirmedAt: "2026-08-08T12:00:00.000Z",
          explorerTxUrl: null,
        },
      ],
      createClient: () => ({}) as never,
      readErc20: async () => ({
        raw: BigInt("3000000000000000000"),
        formatted: "3",
        decimals: 18,
      }),
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    });

    const text = JSON.stringify(snap);
    assert.doesNotMatch(text, /deadbeef|privateKey|FENN_PURSE_PRIVATE_KEY/i);
    assert.equal(snap.state, "ready");
    if (snap.state === "ready") {
      assert.equal(snap.purseAddress, PURSE);
      assert.equal(snap.transfers.length, 1);
      assert.equal(snap.fennBalance.state, "available");
    }
  });

  it("Commons only exposes confirmed transfers (query path filters)", async () => {
    // listConfirmed is the only history source for the public snapshot.
    const snap = await getPublicPurseSnapshot({
      getConfig: async () => ({
        configured: true,
        walletAddress: PURSE,
        isEnabled: true,
      }),
      getOfficialToken: async () => OFFICIAL,
      listConfirmed: async () => [],
      readErc20: async () => ({
        raw: BigInt(1),
        formatted: "0.000000000000000001",
        decimals: 18,
      }),
      createClient: () => ({}) as never,
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    });
    assert.equal(snap.state, "ready");
    if (snap.state === "ready") {
      assert.deepEqual(snap.transfers, []);
    }
  });

  it("unconfigured purse fails closed to public unconfigured state", async () => {
    const snap = await getPublicPurseSnapshot({
      getConfig: async () => ({ configured: false }),
      getOfficialToken: async () => OFFICIAL,
      listConfirmed: async () => [],
      createClient: () => ({}) as never,
      readErc20: async () => {
        throw new Error("no");
      },
      now: () => new Date(),
    });
    assert.equal(snap.state, "unconfigured");
  });
});
