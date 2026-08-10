/**
 * Local-only Treasury *broadcast* path for the launch funding ceremony.
 * Never used by Stage 12, API routes, X agent, or Purse Executor.
 * Key derivation lives in fenn-launch-treasury-key (no write path).
 */

import "server-only";

import {
  createWalletClient,
  http,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  FENN_LAUNCH_ERC20_ABI,
  LaunchFundSignerError,
  resolveTreasuryLaunchSigningAccount,
} from "@/lib/ops/fenn-launch-treasury-key";
import {
  createRobinhoodPublicClient,
  robinhoodChain,
  type RobinhoodPublicClient,
} from "@/lib/treasury/chain";

export {
  FENN_LAUNCH_ERC20_ABI,
  LaunchFundSignerError,
  resolveTreasuryLaunchSigningAccount,
} from "@/lib/ops/fenn-launch-treasury-key";

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
 * Preflight MUST NOT import this module.
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
