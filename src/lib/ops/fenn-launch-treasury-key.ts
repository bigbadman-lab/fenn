/**
 * Local Treasury key derivation for launch funding only.
 * Read-only / identity checks — no wallet client, no transaction submission.
 * Never logs or returns private key material.
 */

import "server-only";

import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { FENN_TREASURY_PRIVATE_KEY_ENV } from "@/lib/ops/fenn-launch-fund-constants";
import { parseEvmAddress } from "@/lib/wallet/evm";

/** Minimal ERC-20 surface for launch fund meta + estimate-only transfer gas. */
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
 * Does not create a wallet client or sign transactions.
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
