/**
 * Stage 12.6 → Purse P0 adapter for transfer_fenn and burn_fenn.
 * Stage 12 never holds purse private keys or chooses token contracts.
 */

import "server-only";

import {
  stage12BurnPurseOperationId,
  stage12TransferPurseOperationId,
} from "@/lib/agent/authority-config";
import type { Stage126FailureClass } from "@/lib/agent/execute-config";
import type {
  ValidatedBurnFennPayload,
  ValidatedTransferFennPayload,
} from "@/lib/agent/effect-payload";
import { PurseError } from "@/lib/purse/errors";
import {
  executeManualOneFennBurn,
  executeManualOneFennTransfer,
  executeManualTestBurn,
  executeManualTestTransfer,
} from "@/lib/purse/transfer";
import type { ManualOneFennTransferResult } from "@/lib/purse/types";

export type TransferFennExecuteSuccess = {
  ok: true;
  transferId: string;
  txHash: string;
  recipientAddress: string;
  amountFormatted: "1";
  isTest: boolean;
  reusedExisting: boolean;
  confirmedAt: string;
  operationId: string;
};

export type TransferFennExecuteFailure = {
  ok: false;
  code: string;
  message: string;
  failureClass: Stage126FailureClass;
  operationId: string;
  txHash?: string | null;
};

export type TransferFennExecuteResult =
  | TransferFennExecuteSuccess
  | TransferFennExecuteFailure;

export type TransferFennAdapterDeps = {
  executeOfficial?: typeof executeManualOneFennTransfer;
  executeTest?: typeof executeManualTestTransfer;
};

export type BurnFennAdapterDeps = {
  executeOfficial?: typeof executeManualOneFennBurn;
  executeTest?: typeof executeManualTestBurn;
};

/**
 * Map Purse settlement outcomes onto Stage 12.6 failure classes.
 */
export function mapPurseOutcomeToFailureClass(
  code: string,
  purseFailureClass?: string | null,
): Stage126FailureClass {
  if (purseFailureClass === "ambiguous" || code === "purse_ambiguous") {
    return "ambiguous";
  }
  if (purseFailureClass === "terminal" || code === "purse_terminal_failed") {
    return "terminal";
  }
  // Definite configuration / policy failures are terminal (no rebroadcast value).
  if (
    code === "purse_invalid_recipient" ||
    code === "purse_amount_not_fixed" ||
    code === "purse_arbitrary_token_forbidden" ||
    code === "purse_native_transfer_forbidden" ||
    code === "purse_wrong_chain" ||
    code === "purse_test_mode_inactive" ||
    code === "purse_test_mode_production_forbidden" ||
    code === "purse_test_mode_official_fenn_exists" ||
    code === "purse_test_token_unavailable" ||
    code === "purse_disabled" ||
    code === "purse_unconfigured"
  ) {
    return "terminal";
  }
  // Pre-broadcast / temporary issues may retry same operation_id.
  if (
    purseFailureClass === "pre_broadcast" ||
    code === "purse_lock_busy" ||
    code === "purse_insufficient_fenn" ||
    code === "purse_insufficient_test_token" ||
    code === "purse_broadcast_failed" ||
    code === "purse_key_missing" ||
    code === "purse_rpc_unavailable" ||
    code === "purse_official_token_unavailable"
  ) {
    return "retryable";
  }
  return "terminal";
}

function fromPurseResult(
  result: ManualOneFennTransferResult,
  operationId: string,
): TransferFennExecuteResult {
  if (result.ok) {
    return {
      ok: true,
      transferId: result.transferId,
      txHash: result.txHash,
      recipientAddress: result.recipientAddress,
      amountFormatted: result.amountFormatted,
      isTest: result.isTest,
      reusedExisting: result.reusedExisting,
      confirmedAt: result.confirmedAt,
      operationId,
    };
  }
  return {
    ok: false,
    code: result.code,
    message: result.message,
    failureClass: mapPurseOutcomeToFailureClass(
      result.code,
      result.failureClass,
    ),
    operationId,
    txHash: result.txHash,
  };
}

/**
 * Execute an already-validated transfer_fenn effect via Purse settlement.
 * Derives deterministic operation_id from the Stage 12 effect id.
 */
export async function executeTransferFennViaPurse(
  input: {
    effectId: string;
    payload: ValidatedTransferFennPayload;
    actorId?: string;
  },
  deps: TransferFennAdapterDeps = {},
): Promise<TransferFennExecuteResult> {
  const operationId = stage12TransferPurseOperationId(input.effectId);
  const actorId =
    input.actorId?.trim() ||
    (input.payload.executionRail === "p1a_test"
      ? "ops:stage12-transfer-fenn-p1a"
      : "ops:stage12-transfer-fenn");

  try {
    if (input.payload.executionRail === "p1a_test") {
      const executeTest = deps.executeTest ?? executeManualTestTransfer;
      const result = await executeTest({
        recipientAddress: input.payload.recipientAddress,
        operationId,
        actorId,
      });
      return fromPurseResult(result, operationId);
    }

    const executeOfficial = deps.executeOfficial ?? executeManualOneFennTransfer;
    const result = await executeOfficial({
      recipientAddress: input.payload.recipientAddress,
      operationId,
      actorId,
    });
    return fromPurseResult(result, operationId);
  } catch (error) {
    if (error instanceof PurseError) {
      return {
        ok: false,
        code: error.code,
        message: error.message,
        failureClass: mapPurseOutcomeToFailureClass(error.code),
        operationId,
      };
    }
    return {
      ok: false,
      code: "transfer_execution_failed",
      message:
        error instanceof Error ? error.message.slice(0, 200) : "transfer failed",
      failureClass: "terminal",
      operationId,
    };
  }
}

/**
 * Execute an already-validated burn_fenn effect via dead-address Purse settlement.
 * operation_id namespace is distinct from transfer_fenn.
 */
export async function executeBurnFennViaPurse(
  input: {
    effectId: string;
    payload: ValidatedBurnFennPayload;
    actorId?: string;
  },
  deps: BurnFennAdapterDeps = {},
): Promise<TransferFennExecuteResult> {
  const operationId = stage12BurnPurseOperationId(input.effectId);
  const actorId =
    input.actorId?.trim() ||
    (input.payload.executionRail === "p1a_test"
      ? "ops:stage12-burn-fenn-p1a"
      : "ops:stage12-burn-fenn");

  try {
    if (input.payload.executionRail === "p1a_test") {
      const executeTest = deps.executeTest ?? executeManualTestBurn;
      const result = await executeTest({
        operationId,
        actorId,
      });
      return fromPurseResult(result, operationId);
    }

    const executeOfficial = deps.executeOfficial ?? executeManualOneFennBurn;
    const result = await executeOfficial({
      operationId,
      actorId,
    });
    return fromPurseResult(result, operationId);
  } catch (error) {
    if (error instanceof PurseError) {
      return {
        ok: false,
        code: error.code,
        message: error.message,
        failureClass: mapPurseOutcomeToFailureClass(error.code),
        operationId,
      };
    }
    return {
      ok: false,
      code: "burn_execution_failed",
      message:
        error instanceof Error ? error.message.slice(0, 200) : "burn failed",
      failureClass: "terminal",
      operationId,
    };
  }
}
