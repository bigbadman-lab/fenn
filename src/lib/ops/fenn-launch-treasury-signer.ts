/**
 * Local-only Treasury signer for the launch funding ceremony.
 * Never used by Stage 12, API routes, X agent, or Purse Executor.
 * Never logs or returns the private key material.
 */

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
  FENN_TREASURY_PRIVATE_KEY_ENV,
} from "@/lib/ops/fenn-launch-fund-constants";
import {
  createRobinhoodPublicClient,
  robinhoodChain,
  type RobinhoodPublicClient,
} from "@/lib/treasury/chain";
import { parseEvmAddress } from "@/lib/wallet/evm";

/** Minimal ERC-20 surface for launch fund (meta + transfer). */
export const FENN_LAUNCH_ERC20_ABI = [
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
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export class LaunchFundSignerError extends Error {
  readonly code:
    | "treasury_key_missing"
    | "treasury_key_invalid"
    | "treasury_key_address_mismatch";

  constructor(
    code: LaunchFundSignerError["code"],
    message: string,
  ) {
    super(message);
    this.name = "LaunchFundSignerError";
    this.code = code;
  }
}

function readRawTreasuryPrivateKey(
  envValue: string | undefined = process.env[FENN_TREASURY_PRIVATE_KEY_ENV],
): Hex {
  if (envValue == null || envValue.trim() === "") {
    throw new LaunchFundSignerError(
      "treasury_key_missing",
      `${FENN_TREASURY_PRIVATE_KEY_ENV} is not configured (local launch-operator only)`,
    );
  }
  const trimmed = envValue.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new LaunchFundSignerError(
      "treasury_key_invalid",
      `${FENN_TREASURY_PRIVATE_KEY_ENV} is not a valid 32-byte hex private key`,
    );
  }
  return withPrefix.toLowerCase() as Hex;
}

/**
 * Derive Treasury signing account and verify it matches treasury_config.
 * Never logs or returns the private key.
 */
export function resolveTreasuryLaunchSigningAccount(
  expectedWalletAddress: string,
  envValue?: string,
): {
  account: ReturnType<typeof privateKeyToAccount>;
  address: string;
} {
  const privateKey = readRawTreasuryPrivateKey(envValue);
  let account: ReturnType<typeof privateKeyToAccount>;
  try {
    account = privateKeyToAccount(privateKey);
  } catch {
    throw new LaunchFundSignerError(
      "treasury_key_invalid",
      `${FENN_TREASURY_PRIVATE_KEY_ENV} could not be loaded`,
    );
  }

  const derived = parseEvmAddress(account.address);
  const expected = parseEvmAddress(expectedWalletAddress);
  if (derived !== expected) {
    throw new LaunchFundSignerError(
      "treasury_key_address_mismatch",
      "FENN_TREASURY_PRIVATE_KEY does not match treasury_config.treasury_wallet_address",
    );
  }

  return { account, address: derived };
}

export type BroadcastTreasuryErc20TransferInput = {
  treasuryAddress: string;
  tokenAddress: string;
  recipientAddress: string;
  amountRaw: bigint;
  rpcUrl?: string;
  /** Test injection — private key env override without process mutation. */
  privateKeyEnv?: string;
};

export type BroadcastTreasuryErc20TransferResult =
  | { kind: "submitted"; txHash: string }
  | { kind: "pre_broadcast_failed"; error: string }
  | { kind: "ambiguous"; error: string; txHash?: string };

/**
 * Broadcast one ERC-20 transfer() from the Treasury launch signer.
 * Ops-only. Does not wait for confirmation.
 */
export async function broadcastTreasuryErc20Transfer(
  input: BroadcastTreasuryErc20TransferInput,
): Promise<BroadcastTreasuryErc20TransferResult> {
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
    ({ account } = resolveTreasuryLaunchSigningAccount(
      input.treasuryAddress,
      input.privateKeyEnv,
    ));
  } catch (error) {
    if (error instanceof LaunchFundSignerError) {
      return { kind: "pre_broadcast_failed", error: error.code };
    }
    return { kind: "pre_broadcast_failed", error: "treasury_key_invalid" };
  }

  const walletClient = createWalletClient({
    account,
    chain: robinhoodChain,
    transport: http(rpcUrl),
  });

  try {
    const hash = await walletClient.writeContract({
      address: input.tokenAddress as `0x${string}`,
      abi: FENN_LAUNCH_ERC20_ABI,
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
    if (/timeout|timed out|network|ECONNRESET|fetch failed/i.test(message)) {
      return { kind: "ambiguous", error: message };
    }
    return { kind: "pre_broadcast_failed", error: message };
  }
}

export async function waitForLaunchTransactionReceipt(
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

export async function getLaunchTransactionReceipt(
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
