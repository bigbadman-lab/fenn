import "server-only";

import { getPurseConfig } from "@/lib/purse/config";
import { PurseError } from "@/lib/purse/errors";
import { listConfirmedPurseTransfers } from "@/lib/purse/transfers-query";
import type {
  PublicPurseEthBalance,
  PublicPurseFennBalance,
  PublicPurseSnapshot,
  PublicPurseTransfer,
  PurseConfigState,
} from "@/lib/purse/types";
import {
  createRobinhoodPublicClient,
  readErc20Balance,
  readNativeBalance,
  type RobinhoodPublicClient,
} from "@/lib/treasury/chain";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_NATIVE_CURRENCY,
} from "@/lib/treasury/chain-definition";
import { getOfficialFennTokenAsset } from "@/lib/treasury/official-token";
import type { OfficialFennTokenAsset, TreasuryAmount } from "@/lib/treasury/types";

export type PurseSnapshotDeps = {
  getConfig: () => Promise<PurseConfigState>;
  getOfficialToken: () => Promise<OfficialFennTokenAsset | null>;
  listConfirmed: () => Promise<PublicPurseTransfer[]>;
  createClient: () => RobinhoodPublicClient;
  readNative: (
    holder: string,
    client: Pick<RobinhoodPublicClient, "getBalance">,
  ) => Promise<TreasuryAmount>;
  readErc20: (input: {
    tokenAddress: string;
    holder: string;
    decimals: number;
    client: Pick<RobinhoodPublicClient, "readContract">;
  }) => Promise<TreasuryAmount>;
  now: () => Date;
};

const defaultDeps: PurseSnapshotDeps = {
  getConfig: () => getPurseConfig(),
  getOfficialToken: () => getOfficialFennTokenAsset(),
  listConfirmed: () => listConfirmedPurseTransfers(),
  createClient: () => createRobinhoodPublicClient(),
  readNative: readNativeBalance,
  readErc20: readErc20Balance,
  now: () => new Date(),
};

/**
 * Public Purse snapshot for /commons.
 * Never reads or exposes private keys. Confirmed history only.
 * Live ETH via treasury `readNativeBalance`; live FENN via official token only.
 */
export async function getPublicPurseSnapshot(
  overrides?: Partial<PurseSnapshotDeps>,
): Promise<PublicPurseSnapshot> {
  const deps: PurseSnapshotDeps = { ...defaultDeps, ...overrides };
  const observedAt = deps.now().toISOString();

  const config = await deps.getConfig();
  if (!config.configured) {
    return { state: "unconfigured" };
  }

  let transfers: PublicPurseTransfer[] = [];
  try {
    transfers = await deps.listConfirmed();
  } catch (error) {
    if (error instanceof PurseError) {
      console.error("[purse] confirmed history unavailable", error.code);
      transfers = [];
    } else {
      throw error;
    }
  }

  let client: RobinhoodPublicClient | null = null;
  const getClient = (): RobinhoodPublicClient | null => {
    if (client) return client;
    try {
      client = deps.createClient();
      return client;
    } catch {
      return null;
    }
  };

  const ethBalance = await readPublicEthBalance(
    deps,
    config.walletAddress,
    getClient,
  );
  const fennBalance = await readPublicFennBalance(
    deps,
    config.walletAddress,
    getClient,
  );

  const base = {
    purseAddress: config.walletAddress,
    isEnabled: config.isEnabled,
    observedAt,
    ethBalance,
    fennBalance,
    transfers,
  };

  // Snapshot ready when either live balance is observable; both unavailable = soft unavailable.
  if (
    ethBalance.state === "unavailable" &&
    fennBalance.state === "unavailable"
  ) {
    return { state: "unavailable", ...base };
  }

  return { state: "ready", ...base };
}

async function readPublicEthBalance(
  deps: PurseSnapshotDeps,
  purseAddress: string,
  getClient: () => RobinhoodPublicClient | null,
): Promise<PublicPurseEthBalance> {
  const client = getClient();
  if (!client) {
    return { state: "unavailable", reason: "rpc_failed" };
  }

  try {
    const amount = await deps.readNative(purseAddress, client);
    return {
      state: "available",
      balance: amount.formatted,
      decimals: ROBINHOOD_NATIVE_CURRENCY.decimals,
      symbol: "ETH",
      chainId: ROBINHOOD_CHAIN_ID,
    };
  } catch {
    return { state: "unavailable", reason: "rpc_failed" };
  }
}

async function readPublicFennBalance(
  deps: PurseSnapshotDeps,
  purseAddress: string,
  getClient: () => RobinhoodPublicClient | null,
): Promise<PublicPurseFennBalance> {
  let token: OfficialFennTokenAsset | null;
  try {
    token = await deps.getOfficialToken();
  } catch {
    return { state: "unavailable", reason: "token_unavailable" };
  }

  if (!token) {
    return { state: "unavailable", reason: "token_unavailable" };
  }

  if (token.chainId !== ROBINHOOD_CHAIN_ID || !token.contractAddress) {
    return { state: "unavailable", reason: "configuration_error" };
  }

  const client = getClient();
  if (!client) {
    return { state: "unavailable", reason: "rpc_failed" };
  }

  try {
    const amount = await deps.readErc20({
      tokenAddress: token.contractAddress,
      holder: purseAddress,
      decimals: token.decimals,
      client,
    });
    return {
      state: "available",
      balance: amount.formatted,
      decimals: token.decimals,
      tokenAddress: token.contractAddress,
      symbol: "FENN",
      chainId: token.chainId,
    };
  } catch {
    return { state: "unavailable", reason: "rpc_failed" };
  }
}
