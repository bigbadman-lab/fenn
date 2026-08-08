/**
 * Pure Purse P0 policy — no I/O, no private keys.
 * Intent: reject anything that is not fixed 1 official FENN on Robinhood.
 */

import {
  P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
} from "@/lib/purse/constants";
import { PurseError } from "@/lib/purse/errors";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import type { OfficialFennTokenAsset } from "@/lib/treasury/types";
import {
  isNormalizedEvmAddress,
  parseEvmAddress,
} from "@/lib/wallet/evm";

const OPERATION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export function parseOperationId(raw: string): string {
  const trimmed = raw.trim();
  if (!OPERATION_ID_RE.test(trimmed)) {
    throw new PurseError(
      "purse_invalid_operation_id",
      "operation_id must be 1–128 chars: letters, digits, . _ : -",
      400,
    );
  }
  return trimmed;
}

export function parsePurseRecipient(raw: string): string {
  try {
    return parseEvmAddress(raw);
  } catch {
    throw new PurseError(
      "purse_invalid_recipient",
      "Recipient is not a valid EVM address",
      400,
    );
  }
}

/**
 * P0 manual amount is fixed to exactly 1 FENN (formatted decimal).
 * There is no parameter that can raise or lower it.
 */
export function assertP0ManualAmount(amountFormatted: string): "1" {
  if (amountFormatted.trim() !== P0_MANUAL_TRANSFER_AMOUNT_FORMATTED) {
    throw new PurseError(
      "purse_amount_not_fixed",
      "P0 manual transfer amount must be exactly 1 FENN",
      400,
    );
  }
  return P0_MANUAL_TRANSFER_AMOUNT_FORMATTED;
}

/** Native token transfers are never supported by the Purse module. */
export function assertNotNativeTransfer(kind: "native" | "erc20"): void {
  if (kind === "native") {
    throw new PurseError(
      "purse_native_transfer_forbidden",
      "Purse P0 cannot transfer the native gas token",
      400,
    );
  }
}

/**
 * Requested token (if any) must equal the official FENN contract.
 * Callers that cannot name a token simply pass the official asset only.
 */
export function assertOfficialFennTokenOnly(
  official: OfficialFennTokenAsset | null,
  requestedTokenAddress?: string | null,
): OfficialFennTokenAsset {
  if (!official) {
    throw new PurseError(
      "purse_official_token_unavailable",
      "Official FENN token is not available (missing or ambiguous)",
      503,
    );
  }

  if (official.chainId !== ROBINHOOD_CHAIN_ID) {
    throw new PurseError(
      "purse_wrong_chain",
      "Official FENN token is not on Robinhood Chain",
      500,
    );
  }

  if (
    !official.contractAddress ||
    !isNormalizedEvmAddress(official.contractAddress)
  ) {
    throw new PurseError(
      "purse_official_token_unavailable",
      "Official FENN token contract is invalid",
      500,
    );
  }

  if (requestedTokenAddress != null && requestedTokenAddress.trim() !== "") {
    let requested: string;
    try {
      requested = parseEvmAddress(requestedTokenAddress);
    } catch {
      throw new PurseError(
        "purse_arbitrary_token_forbidden",
        "Requested token address is invalid",
        400,
      );
    }
    if (requested !== official.contractAddress) {
      throw new PurseError(
        "purse_arbitrary_token_forbidden",
        "Purse P0 may only transfer the official FENN ERC-20",
        400,
      );
    }
  }

  return official;
}

export function assertRobinhoodChainId(chainId: number): void {
  if (chainId !== ROBINHOOD_CHAIN_ID) {
    throw new PurseError(
      "purse_wrong_chain",
      `Purse P0 requires Robinhood Chain (${ROBINHOOD_CHAIN_ID})`,
      400,
    );
  }
}

/**
 * Whether a prior settlement may attempt broadcast again.
 * Only pre_broadcast failures are eligible.
 * Ambiguous / submitted / terminal never rebroadcast intentionally.
 */
export function mayRetryBroadcast(row: {
  status: string;
  failureClass: string | null;
  txHash: string | null;
}): boolean {
  if (row.txHash != null && row.txHash.trim() !== "") {
    return false;
  }
  if (row.status === "pending") return true;
  if (row.status === "failed" && row.failureClass === "pre_broadcast") {
    return true;
  }
  return false;
}

/**
 * Whether we should reconcile an existing tx rather than send a new one.
 */
export function shouldReconcileExistingTx(row: {
  status: string;
  txHash: string | null;
}): boolean {
  if (row.status === "confirmed") return false;
  if (row.txHash != null && row.txHash.trim() !== "") return true;
  return false;
}
