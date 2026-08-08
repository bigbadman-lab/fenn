import "server-only";

import {
  createWalletClient,
  http,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  FENN_PURSE_PRIVATE_KEY_ENV,
} from "@/lib/purse/constants";
import { PurseError } from "@/lib/purse/errors";
import {
  createRobinhoodPublicClient,
  robinhoodChain,
  type RobinhoodPublicClient,
} from "@/lib/treasury/chain";
import { parseEvmAddress } from "@/lib/wallet/evm";

/** Minimal ERC-20 transfer surface. No approve, no arbitrary calldata paths. */
export const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function readRawPrivateKey(
  envValue: string | undefined = process.env[FENN_PURSE_PRIVATE_KEY_ENV],
): Hex {
  if (envValue == null || envValue.trim() === "") {
    throw new PurseError(
      "purse_key_missing",
      `${FENN_PURSE_PRIVATE_KEY_ENV} is not configured`,
      500,
    );
  }
  const trimmed = envValue.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new PurseError(
      "purse_key_invalid",
      `${FENN_PURSE_PRIVATE_KEY_ENV} is not a valid 32-byte hex private key`,
      500,
    );
  }
  return withPrefix.toLowerCase() as Hex;
}

/**
 * Derive the Purse signing account and verify it matches purse_config.
 * Never logs or returns the private key.
 */
export function resolvePurseSigningAccount(expectedWalletAddress: string): {
  account: ReturnType<typeof privateKeyToAccount>;
  address: string;
} {
  const privateKey = readRawPrivateKey();
  let account: ReturnType<typeof privateKeyToAccount>;
  try {
    account = privateKeyToAccount(privateKey);
  } catch {
    throw new PurseError(
      "purse_key_invalid",
      `${FENN_PURSE_PRIVATE_KEY_ENV} could not be loaded`,
      500,
    );
  }

  const derived = parseEvmAddress(account.address);
  const expected = parseEvmAddress(expectedWalletAddress);
  if (derived !== expected) {
    throw new PurseError(
      "purse_key_address_mismatch",
      "FENN_PURSE_PRIVATE_KEY does not match purse_config.purse_wallet_address",
      500,
    );
  }

  return { account, address: derived };
}

export type BroadcastErc20TransferInput = {
  purseAddress: string;
  tokenAddress: string;
  recipientAddress: string;
  amountRaw: bigint;
  rpcUrl?: string;
};

export type BroadcastErc20TransferResult =
  | { kind: "submitted"; txHash: string }
  | { kind: "pre_broadcast_failed"; error: string }
  | { kind: "ambiguous"; error: string; txHash?: string };

/**
 * Broadcast a single ERC-20 transfer() from the Purse.
 * Does not wait for confirmation — caller owns receipt lifecycle.
 */
export async function broadcastOfficialFennTransfer(
  input: BroadcastErc20TransferInput,
): Promise<BroadcastErc20TransferResult> {
  const rpcUrl =
    input.rpcUrl?.trim() || process.env.ROBINHOOD_CHAIN_RPC_URL?.trim();
  if (!rpcUrl) {
    return {
      kind: "pre_broadcast_failed",
      error: "ROBINHOOD_CHAIN_RPC_URL is not configured",
    };
  }

  let account: ReturnType<typeof privateKeyToAccount>;
  try {
    ({ account } = resolvePurseSigningAccount(input.purseAddress));
  } catch (error) {
    if (error instanceof PurseError) {
      return { kind: "pre_broadcast_failed", error: error.code };
    }
    return { kind: "pre_broadcast_failed", error: "purse_key_invalid" };
  }

  const walletClient = createWalletClient({
    account,
    chain: robinhoodChain,
    transport: http(rpcUrl),
  });

  try {
    const hash = await walletClient.writeContract({
      address: input.tokenAddress as `0x${string}`,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [
        input.recipientAddress as `0x${string}`,
        input.amountRaw,
      ],
      chain: robinhoodChain,
      account,
    });
    return { kind: "submitted", txHash: hash };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 200) : "broadcast_failed";
    // If we somehow already have a hash in the error payload, treat as ambiguous.
    const maybeHash =
      error &&
      typeof error === "object" &&
      "hash" in error &&
      typeof (error as { hash?: unknown }).hash === "string"
        ? String((error as { hash: string }).hash)
        : null;
    if (maybeHash && /^0x[a-fA-F0-9]{64}$/.test(maybeHash)) {
      return { kind: "ambiguous", error: message, txHash: maybeHash };
    }
    // Timeouts after submission often lack a clean failure — mark ambiguous.
    if (/timeout|timed out|network|ECONNRESET|fetch failed/i.test(message)) {
      return { kind: "ambiguous", error: message };
    }
    return { kind: "pre_broadcast_failed", error: message };
  }
}

export async function waitForPurseTransactionReceipt(
  txHash: string,
  client: RobinhoodPublicClient = createRobinhoodPublicClient(),
): Promise<
  | { kind: "success"; receipt: TransactionReceipt }
  | { kind: "reverted"; receipt: TransactionReceipt }
  | { kind: "unknown"; error: string }
> {
  try {
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash as Hash,
      confirmations: 1,
    });
    if (receipt.status === "success") {
      return { kind: "success", receipt };
    }
    return { kind: "reverted", receipt };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 200) : "receipt_unknown";
    return { kind: "unknown", error: message };
  }
}

export async function getPurseTransactionReceipt(
  txHash: string,
  client: RobinhoodPublicClient = createRobinhoodPublicClient(),
): Promise<
  | { kind: "success"; receipt: TransactionReceipt }
  | { kind: "reverted"; receipt: TransactionReceipt }
  | { kind: "missing" }
  | { kind: "unknown"; error: string }
> {
  try {
    const receipt = await client.getTransactionReceipt({
      hash: txHash as Hash,
    });
    if (receipt.status === "success") {
      return { kind: "success", receipt };
    }
    return { kind: "reverted", receipt };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 200) : "receipt_error";
    if (/not found|could not be found|Null/i.test(message)) {
      return { kind: "missing" };
    }
    return { kind: "unknown", error: message };
  }
}
