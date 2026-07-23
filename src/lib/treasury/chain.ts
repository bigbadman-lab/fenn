import "server-only";

import {
  createPublicClient,
  defineChain,
  http,
  type PublicClient,
  type Transport,
} from "viem";

import { toTreasuryAmount } from "@/lib/treasury/amounts";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_NATIVE_CURRENCY,
} from "@/lib/treasury/chain-definition";
import { TreasuryError } from "@/lib/treasury/errors";
import type { TreasuryAmount } from "@/lib/treasury/types";
import { parseEvmAddress } from "@/lib/wallet/evm";

/** Minimal ERC-20 surface — balanceOf only. No writes. */
export const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: ROBINHOOD_NATIVE_CURRENCY,
  rpcUrls: {
    default: {
      http: ["https://rpc.mainnet.chain.robinhood.com"],
    },
  },
});

export type RobinhoodPublicClient = PublicClient<Transport, typeof robinhoodChain>;

/**
 * Read-only public client for Robinhood Chain.
 * Requires server-only ROBINHOOD_CHAIN_RPC_URL. No private keys / signing.
 */
export function createRobinhoodPublicClient(
  rpcUrl: string | undefined = process.env.ROBINHOOD_CHAIN_RPC_URL,
): RobinhoodPublicClient {
  const url = rpcUrl?.trim();
  if (!url) {
    throw new TreasuryError(
      "treasury_rpc_unavailable",
      "Robinhood Chain RPC is not configured",
      503,
    );
  }

  return createPublicClient({
    chain: robinhoodChain,
    transport: http(url),
  });
}

export async function readNativeBalance(
  holder: string,
  client: Pick<RobinhoodPublicClient, "getBalance">,
): Promise<TreasuryAmount> {
  const address = parseEvmAddress(holder);
  try {
    const raw = await client.getBalance({ address: address as `0x${string}` });
    return toTreasuryAmount(raw, ROBINHOOD_NATIVE_CURRENCY.decimals);
  } catch (error) {
    if (error instanceof TreasuryError) throw error;
    throw new TreasuryError(
      "treasury_read_failed",
      "Failed to read native Treasury balance",
      502,
    );
  }
}

export async function readErc20Balance(input: {
  tokenAddress: string;
  holder: string;
  decimals: number;
  client: Pick<RobinhoodPublicClient, "readContract">;
}): Promise<TreasuryAmount> {
  const token = parseEvmAddress(input.tokenAddress);
  const holder = parseEvmAddress(input.holder);

  try {
    const raw = await input.client.readContract({
      address: token as `0x${string}`,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [holder as `0x${string}`],
    });
    return toTreasuryAmount(raw, input.decimals);
  } catch (error) {
    if (error instanceof TreasuryError) throw error;
    throw new TreasuryError(
      "treasury_read_failed",
      "Failed to read ERC-20 Treasury balance",
      502,
    );
  }
}
