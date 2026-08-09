import "server-only";

import {
  P0_MANUAL_ACTOR_ID,
  P0_MANUAL_TEST_ACTOR_ID,
  P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
} from "@/lib/purse/constants";
import { requireEnabledPurseConfig } from "@/lib/purse/config";
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
import {
  getPurseTransferByOperationId,
  insertPendingPurseTransfer,
  markPurseTransferConfirmed,
  markPurseTransferFailed,
  markPurseTransferSubmitted,
  releasePurseTransferLock,
  resetPurseTransferForRetry,
  tryAcquirePurseTransferLock,
} from "@/lib/purse/settlement";
import { resolveArmedPurseTestToken } from "@/lib/purse/test-mode";
import type {
  ManualOneFennTransferInput,
  ManualOneFennTransferResult,
  PurseTransferRow,
} from "@/lib/purse/types";
import {
  broadcastOfficialFennTransfer,
  getPurseTransactionReceipt,
  waitForPurseTransactionReceipt,
  type BroadcastErc20TransferResult,
} from "@/lib/purse/wallet";
import { parseTokenAmountToRaw } from "@/lib/treasury/amounts";
import {
  createRobinhoodPublicClient,
  readErc20Balance,
} from "@/lib/treasury/chain";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { getOfficialFennTokenAsset } from "@/lib/treasury/official-token";
import type { OfficialFennTokenAsset } from "@/lib/treasury/types";
import type { TreasuryAmount } from "@/lib/treasury/types";

/** Settlement token — either official FENN or armed disposable test ERC-20. */
export type PurseUnitTransferToken = {
  contractAddress: string;
  decimals: number;
  chainId: number;
};

export type ManualTransferDeps = {
  getPurse: () => Promise<{ walletAddress: string }>;
  getOfficialToken: () => Promise<OfficialFennTokenAsset | null>;
  acquireLock: () => Promise<boolean>;
  releaseLock: () => Promise<void>;
  getByOperationId: (operationId: string) => Promise<PurseTransferRow | null>;
  insertPending: (input: {
    operationId: string;
    recipientAddress: string;
    amountRaw: string;
    amountFormatted: string;
    tokenAddress: string;
    chainId: number;
    actorId: string;
    isTest: boolean;
  }) => Promise<PurseTransferRow>;
  markSubmitted: (input: {
    id: string;
    txHash: string;
    submittedAt: string;
  }) => Promise<PurseTransferRow>;
  markConfirmed: (input: {
    id: string;
    txHash: string;
    confirmedAt: string;
    submittedAt?: string | null;
  }) => Promise<PurseTransferRow>;
  markFailed: (input: {
    id: string;
    failureClass: "pre_broadcast" | "terminal" | "ambiguous";
    lastError: string;
    txHash?: string | null;
    status?: "failed" | "ambiguous";
  }) => Promise<PurseTransferRow>;
  resetForRetry: (id: string) => Promise<PurseTransferRow>;
  readTokenBalance: (input: {
    tokenAddress: string;
    holder: string;
    decimals: number;
  }) => Promise<TreasuryAmount>;
  broadcast: (input: {
    purseAddress: string;
    tokenAddress: string;
    recipientAddress: string;
    amountRaw: bigint;
  }) => Promise<BroadcastErc20TransferResult>;
  waitReceipt: (
    txHash: string,
  ) => Promise<
    | { kind: "success" }
    | { kind: "reverted" }
    | { kind: "unknown"; error: string }
  >;
  getReceipt: (
    txHash: string,
  ) => Promise<
    | { kind: "success" }
    | { kind: "reverted" }
    | { kind: "missing" }
    | { kind: "unknown"; error: string }
  >;
  now: () => Date;
  /**
   * @deprecated Prefer readTokenBalance. Kept so older tests that set
   * `readFennBalance` continue to work when fully replacing deps via makeDeps.
   */
  readFennBalance?: ManualTransferDeps["readTokenBalance"];
};

function defaultDeps(): ManualTransferDeps {
  return {
    getPurse: () => requireEnabledPurseConfig(),
    getOfficialToken: () => getOfficialFennTokenAsset(),
    acquireLock: () => tryAcquirePurseTransferLock(),
    releaseLock: () => releasePurseTransferLock(),
    getByOperationId: (operationId) => getPurseTransferByOperationId(operationId),
    insertPending: (input) => insertPendingPurseTransfer(input),
    markSubmitted: (input) => markPurseTransferSubmitted(input),
    markConfirmed: (input) => markPurseTransferConfirmed(input),
    markFailed: (input) => markPurseTransferFailed(input),
    resetForRetry: (id) => resetPurseTransferForRetry(id),
    readTokenBalance: async ({ tokenAddress, holder, decimals }) => {
      const client = createRobinhoodPublicClient();
      return readErc20Balance({
        tokenAddress,
        holder,
        decimals,
        client,
      });
    },
    broadcast: (input) => broadcastOfficialFennTransfer(input),
    waitReceipt: async (txHash) => {
      const result = await waitForPurseTransactionReceipt(txHash);
      if (result.kind === "success") return { kind: "success" };
      if (result.kind === "reverted") return { kind: "reverted" };
      return { kind: "unknown", error: result.error };
    },
    getReceipt: async (txHash) => {
      const result = await getPurseTransactionReceipt(txHash);
      if (result.kind === "success") return { kind: "success" };
      if (result.kind === "reverted") return { kind: "reverted" };
      if (result.kind === "missing") return { kind: "missing" };
      return { kind: "unknown", error: result.error };
    },
    now: () => new Date(),
  };
}

function mergeDeps(overrides?: Partial<ManualTransferDeps>): ManualTransferDeps {
  const base = defaultDeps();
  const merged = { ...base, ...overrides };
  // Back-compat: tests historically injected readFennBalance.
  if (overrides?.readFennBalance && !overrides.readTokenBalance) {
    merged.readTokenBalance = overrides.readFennBalance;
  }
  return merged;
}

function confirmedResult(
  row: PurseTransferRow,
  purseAddress: string,
  reusedExisting: boolean,
): ManualOneFennTransferResult {
  if (!row.txHash || !row.confirmedAt) {
    return {
      ok: false,
      code: "purse_settlement_failed",
      message: "Confirmed settlement missing tx hash or timestamp",
      operationId: row.operationId,
      status: row.status,
    };
  }
  return {
    ok: true,
    status: "confirmed",
    operationId: row.operationId,
    transferId: row.id,
    recipientAddress: row.recipientAddress,
    amountFormatted: P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
    tokenAddress: row.tokenAddress,
    chainId: row.chainId,
    purseAddress,
    txHash: row.txHash,
    confirmedAt: row.confirmedAt,
    reusedExisting,
    isTest: row.isTest,
  };
}

function failResult(
  row: PurseTransferRow,
  code: string,
  message: string,
): ManualOneFennTransferResult {
  return {
    ok: false,
    code,
    message,
    operationId: row.operationId,
    status: row.status,
    txHash: row.txHash,
    failureClass: row.failureClass,
  };
}

async function finalizeReceipt(
  deps: ManualTransferDeps,
  row: PurseTransferRow,
  txHash: string,
  purseAddress: string,
  reusedExisting: boolean,
): Promise<ManualOneFennTransferResult> {
  const receipt = await deps.waitReceipt(txHash);
  if (receipt.kind === "success") {
    const confirmed = await deps.markConfirmed({
      id: row.id,
      txHash,
      confirmedAt: deps.now().toISOString(),
      submittedAt: row.submittedAt,
    });
    return confirmedResult(confirmed, purseAddress, reusedExisting);
  }
  if (receipt.kind === "reverted") {
    const failed = await deps.markFailed({
      id: row.id,
      failureClass: "terminal",
      lastError: "transaction_reverted",
      txHash,
      status: "failed",
    });
    return failResult(failed, "purse_terminal_failed", "Transaction reverted on chain");
  }
  const ambiguous = await deps.markFailed({
    id: row.id,
    failureClass: "ambiguous",
    lastError: receipt.error,
    txHash,
    status: "ambiguous",
  });
  return failResult(
    ambiguous,
    "purse_ambiguous",
    "Transaction broadcast outcome is ambiguous — do not rebroadcast; reconcile using the known tx hash if present",
  );
}

async function reconcileKnownTx(
  deps: ManualTransferDeps,
  row: PurseTransferRow,
  purseAddress: string,
): Promise<ManualOneFennTransferResult> {
  const txHash = row.txHash;
  if (!txHash) {
    return failResult(row, "purse_settlement_failed", "Missing tx hash for reconcile");
  }

  const receipt = await deps.getReceipt(txHash);
  if (receipt.kind === "success") {
    const confirmed = await deps.markConfirmed({
      id: row.id,
      txHash,
      confirmedAt: deps.now().toISOString(),
      submittedAt: row.submittedAt ?? deps.now().toISOString(),
    });
    return confirmedResult(confirmed, purseAddress, true);
  }
  if (receipt.kind === "reverted") {
    const failed = await deps.markFailed({
      id: row.id,
      failureClass: "terminal",
      lastError: "transaction_reverted",
      txHash,
      status: "failed",
    });
    return failResult(failed, "purse_terminal_failed", "Known transaction reverted");
  }
  if (receipt.kind === "missing") {
    // Still wait — tx may be pending inclusion.
    return finalizeReceipt(deps, row, txHash, purseAddress, true);
  }
  const ambiguous = await deps.markFailed({
    id: row.id,
    failureClass: "ambiguous",
    lastError: receipt.error,
    txHash,
    status: "ambiguous",
  });
  return failResult(
    ambiguous,
    "purse_ambiguous",
    "Cannot confirm known transaction — do not rebroadcast",
  );
}

type UnitTransferContext = {
  token: PurseUnitTransferToken;
  isTest: boolean;
  insufficientCode: "purse_insufficient_fenn" | "purse_insufficient_test_token";
  insufficientMessage: (balanceFormatted: string) => string;
};

/**
 * Shared P0 unit-transfer lifecycle (one ERC-20 unit, fixed "1").
 * Used by official FENN path and disposable test path — never by agents.
 */
async function executeManualUnitTransfer(
  input: ManualOneFennTransferInput,
  context: UnitTransferContext,
  overrides?: Partial<ManualTransferDeps>,
): Promise<ManualOneFennTransferResult> {
  // Hard policy: P0 never transfers native.
  assertNotNativeTransfer("erc20");
  assertP0ManualAmount(P0_MANUAL_TRANSFER_AMOUNT_FORMATTED);
  assertRobinhoodChainId(context.token.chainId);

  const operationId = parseOperationId(input.operationId);
  const recipientAddress = parsePurseRecipient(input.recipientAddress);
  const actorId =
    input.actorId?.trim() ||
    (context.isTest ? P0_MANUAL_TEST_ACTOR_ID : P0_MANUAL_ACTOR_ID);

  const deps = mergeDeps(overrides);

  const purse = await deps.getPurse();

  if (recipientAddress === purse.walletAddress) {
    throw new PurseError(
      "purse_invalid_recipient",
      "Recipient cannot be the Purse wallet itself",
      400,
    );
  }

  const amountRaw = parseTokenAmountToRaw(
    P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
    context.token.decimals,
  );
  const amountRawStr = amountRaw.toString();
  const tokenAddress = context.token.contractAddress;

  const locked = await deps.acquireLock();
  if (!locked) {
    return {
      ok: false,
      code: "purse_lock_busy",
      message:
        "Another Purse transfer is in progress — P0 allows one transfer at a time",
      operationId,
    };
  }

  try {
    let row = await deps.getByOperationId(operationId);

    if (!row) {
      row = await deps.insertPending({
        operationId,
        recipientAddress,
        amountRaw: amountRawStr,
        amountFormatted: P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
        tokenAddress,
        chainId: ROBINHOOD_CHAIN_ID,
        actorId,
        isTest: context.isTest,
      });
    }

    // Validate settlement identity against current request (idempotent reuse).
    if (
      row.recipientAddress !== recipientAddress ||
      row.amountFormatted !== P0_MANUAL_TRANSFER_AMOUNT_FORMATTED ||
      row.tokenAddress !== tokenAddress ||
      row.chainId !== ROBINHOOD_CHAIN_ID ||
      row.isTest !== context.isTest
    ) {
      return failResult(
        row,
        "purse_settlement_failed",
        "operation_id already used with different transfer parameters",
      );
    }

    if (row.status === "confirmed") {
      return confirmedResult(row, purse.walletAddress, true);
    }

    if (row.status === "ambiguous") {
      // Never rebroadcast. Attempt soft reconcile if hash known.
      if (row.txHash) {
        return reconcileKnownTx(deps, row, purse.walletAddress);
      }
      return failResult(
        row,
        "purse_ambiguous",
        "Prior broadcast is ambiguous with no known hash — operator must reconcile manually; will not rebroadcast",
      );
    }

    if (row.status === "failed" && row.failureClass === "terminal") {
      return failResult(
        row,
        "purse_terminal_failed",
        row.lastError ?? "Prior transfer failed terminally",
      );
    }

    if (shouldReconcileExistingTx(row)) {
      return reconcileKnownTx(deps, row, purse.walletAddress);
    }

    if (!mayRetryBroadcast(row)) {
      return failResult(
        row,
        "purse_settlement_failed",
        `Settlement status ${row.status} cannot broadcast`,
      );
    }

    if (row.status === "failed" && row.failureClass === "pre_broadcast") {
      row = await deps.resetForRetry(row.id);
    }

    // Balance preflight (insufficient balances fail before broadcast).
    const balance = await deps.readTokenBalance({
      tokenAddress,
      holder: purse.walletAddress,
      decimals: context.token.decimals,
    });
    if (balance.raw < amountRaw) {
      const failed = await deps.markFailed({
        id: row.id,
        failureClass: "pre_broadcast",
        lastError: context.isTest
          ? "insufficient_test_token_balance"
          : "insufficient_fenn_balance",
        status: "failed",
      });
      return failResult(
        failed,
        context.insufficientCode,
        context.insufficientMessage(balance.formatted),
      );
    }

    const broadcast = await deps.broadcast({
      purseAddress: purse.walletAddress,
      tokenAddress,
      recipientAddress,
      amountRaw,
    });

    if (broadcast.kind === "pre_broadcast_failed") {
      const failed = await deps.markFailed({
        id: row.id,
        failureClass: "pre_broadcast",
        lastError: broadcast.error,
        status: "failed",
      });
      return failResult(failed, "purse_broadcast_failed", broadcast.error);
    }

    if (broadcast.kind === "ambiguous") {
      const failed = await deps.markFailed({
        id: row.id,
        failureClass: "ambiguous",
        lastError: broadcast.error,
        txHash: broadcast.txHash ?? null,
        status: "ambiguous",
      });
      return failResult(
        failed,
        "purse_ambiguous",
        "Broadcast outcome is uncertain — do not retry by sending again",
      );
    }

    const submittedAt = deps.now().toISOString();
    row = await deps.markSubmitted({
      id: row.id,
      txHash: broadcast.txHash,
      submittedAt,
    });

    return finalizeReceipt(
      deps,
      row,
      broadcast.txHash,
      purse.walletAddress,
      false,
    );
  } finally {
    await deps.releaseLock();
  }
}

/**
 * Operator-only P0 path: transfer exactly 1 official FENN from the Purse.
 *
 * - Fixed amount "1" (no amount parameter accepted by the public API)
 * - Official FENN ERC-20 only (never reads FENN_PURSE_TEST_*)
 * - Robinhood Chain only
 * - Idempotent on operationId
 * - Never rebroadcasts ambiguous / known-tx operations
 * - Completes only after chain confirmation
 */
export async function executeManualOneFennTransfer(
  input: ManualOneFennTransferInput,
  overrides?: Partial<ManualTransferDeps>,
): Promise<ManualOneFennTransferResult> {
  const deps = mergeDeps(overrides);
  const official = assertOfficialFennTokenOnly(await deps.getOfficialToken());

  return executeManualUnitTransfer(
    input,
    {
      token: {
        contractAddress: official.contractAddress,
        decimals: official.decimals,
        chainId: official.chainId,
      },
      isTest: false,
      insufficientCode: "purse_insufficient_fenn",
      insufficientMessage: (balanceFormatted) =>
        `Purse FENN balance ${balanceFormatted} is less than 1`,
    },
    overrides,
  );
}

/**
 * True when official FENN can successfully resolve for production transfers.
 * Incomplete/invalid candidates do not close the test rail.
 */
export function officialFennSuccessfullyResolves(
  official: OfficialFennTokenAsset | null,
): boolean {
  if (!official) return false;
  try {
    assertOfficialFennTokenOnly(official);
    return true;
  } catch {
    return false;
  }
}

function refuseTestRailIfOfficialFennLive(
  official: OfficialFennTokenAsset | null,
): void {
  if (officialFennSuccessfullyResolves(official)) {
    throw new PurseError(
      "purse_test_mode_official_fenn_exists",
      "Official FENN is configured — disposable Purse test rail is permanently closed",
      403,
    );
  }
}

/**
 * Operator-only pre-launch test path: transfer exactly 1 disposable ERC-20.
 *
 * Never used in production hosts. Never runs once official FENN resolves.
 * Never reads as official FENN. Persists is_test = true.
 */
export async function executeManualTestTransfer(
  input: ManualOneFennTransferInput,
  overrides?: Partial<ManualTransferDeps>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ManualOneFennTransferResult> {
  const testToken = resolveArmedPurseTestToken(env);

  const deps = mergeDeps(overrides);
  refuseTestRailIfOfficialFennLive(await deps.getOfficialToken());

  return executeManualUnitTransfer(
    input,
    {
      token: {
        contractAddress: testToken.contractAddress,
        decimals: testToken.decimals,
        chainId: testToken.chainId,
      },
      isTest: true,
      insufficientCode: "purse_insufficient_test_token",
      insufficientMessage: (balanceFormatted) =>
        `Purse test-token balance ${balanceFormatted} is less than 1`,
    },
    overrides,
  );
}

/**
 * Safe preview fields for operator CLI (never includes the private key).
 */
export async function buildManualTransferPreview(input: {
  recipientAddress: string;
  operationId: string;
}): Promise<{
  mode: "OFFICIAL";
  purseAddress: string;
  recipient: string;
  amount: "1";
  asset: "FENN";
  tokenAddress: string;
  chainId: number;
  chainName: "Robinhood Chain";
  operationId: string;
  warning: null;
}> {
  const operationId = parseOperationId(input.operationId);
  const recipient = parsePurseRecipient(input.recipientAddress);
  const purse = await requireEnabledPurseConfig();
  const official = assertOfficialFennTokenOnly(await getOfficialFennTokenAsset());
  return {
    mode: "OFFICIAL",
    purseAddress: purse.walletAddress,
    recipient,
    amount: P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
    asset: "FENN",
    tokenAddress: official.contractAddress,
    chainId: ROBINHOOD_CHAIN_ID,
    chainName: "Robinhood Chain",
    operationId,
    warning: null,
  };
}

/**
 * Safe preview for disposable-token test CLI. Never prints the private key.
 */
export async function buildManualTestTransferPreview(
  input: {
    recipientAddress: string;
    operationId: string;
  },
  env: NodeJS.ProcessEnv = process.env,
  getOfficialToken: () => Promise<OfficialFennTokenAsset | null> = () =>
    getOfficialFennTokenAsset(),
): Promise<{
  mode: "TEST";
  purseAddress: string;
  recipient: string;
  amount: "1";
  asset: "TEST";
  tokenAddress: string;
  chainId: number;
  chainName: "Robinhood Chain";
  operationId: string;
  warning: "NOT OFFICIAL FENN";
}> {
  const testToken = resolveArmedPurseTestToken(env);
  refuseTestRailIfOfficialFennLive(await getOfficialToken());

  const operationId = parseOperationId(input.operationId);
  const recipient = parsePurseRecipient(input.recipientAddress);
  const purse = await requireEnabledPurseConfig();

  return {
    mode: "TEST",
    purseAddress: purse.walletAddress,
    recipient,
    amount: P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
    asset: "TEST",
    tokenAddress: testToken.contractAddress,
    chainId: ROBINHOOD_CHAIN_ID,
    chainName: "Robinhood Chain",
    operationId,
    warning: "NOT OFFICIAL FENN",
  };
}
