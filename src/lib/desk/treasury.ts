import "server-only";

import { getCommonsCommitments } from "@/lib/commons/commitments";
import type { PublicCommonsCommitment } from "@/lib/commons/types";
import {
  robinhoodAddressExplorerUrl,
  shortenWallet,
} from "@/lib/greenwood/hollow/explorer";
import { getPublicTreasurySnapshot } from "@/lib/treasury/snapshot";
import type { PublicTreasurySnapshot } from "@/lib/treasury/types";

export type DeskTreasuryStatus =
  | "readable"
  | "unavailable"
  | "unconfigured"
  | "partial";

export type DeskTreasuryAsset = {
  symbol: string;
  name: string | null;
  contractAddress: string | null;
  balance: string | null;
  readState: "available" | "unavailable";
  reason: "rpc_failed" | "configuration_error" | null;
};

export type DeskTreasurySnapshot = {
  status: DeskTreasuryStatus;
  rpcConfigured: boolean;
  walletAddress: string | null;
  walletShort: string | null;
  explorerUrl: string | null;
  observedAt: string | null;
  assets: DeskTreasuryAsset[];
  commons: PublicCommonsCommitment[];
  commonsAvailable: boolean;
  warnings: string[];
  serverNow: string;
};

function rpcConfigured(): boolean {
  return Boolean(process.env.ROBINHOOD_CHAIN_RPC_URL?.trim());
}

function toDeskStatus(
  snapshot: PublicTreasurySnapshot,
): DeskTreasuryStatus {
  if (snapshot.state === "unconfigured") return "unconfigured";
  if (snapshot.state === "unavailable") return "unavailable";
  const failed = snapshot.assets.some((a) => a.state === "unavailable");
  if (failed) return "partial";
  return "readable";
}

export async function getDeskTreasurySnapshot(): Promise<DeskTreasurySnapshot> {
  const snapshot = await getPublicTreasurySnapshot();
  const warnings: string[] = [];
  const rpcOk = rpcConfigured();
  if (!rpcOk) warnings.push("RPC is not configured.");

  if (snapshot.state === "unconfigured") {
    warnings.push("Treasury wallet is not configured.");
    return {
      status: "unconfigured",
      rpcConfigured: rpcOk,
      walletAddress: null,
      walletShort: null,
      explorerUrl: null,
      observedAt: null,
      assets: [],
      commons: [],
      commonsAvailable: false,
      warnings,
      serverNow: new Date().toISOString(),
    };
  }

  const assets: DeskTreasuryAsset[] = snapshot.assets.map((a) => {
    if (a.state === "available") {
      return {
        symbol: a.symbol,
        name: a.name,
        contractAddress: a.contractAddress,
        balance: a.balance,
        readState: "available",
        reason: null,
      };
    }
    if (a.reason === "rpc_failed") {
      warnings.push(`${a.symbol} could not be read (RPC).`);
    } else {
      warnings.push(`${a.symbol} has a configuration error.`);
    }
    return {
      symbol: a.symbol,
      name: a.name,
      contractAddress: a.contractAddress,
      balance: null,
      readState: "unavailable",
      reason: a.reason,
    };
  });

  if (snapshot.assets.length === 0) {
    warnings.push("No tracked assets.");
  }
  if (snapshot.state === "unavailable") {
    warnings.push("Treasury read is unavailable.");
  }

  let commons: PublicCommonsCommitment[] = [];
  let commonsAvailable = true;
  try {
    commons = await getCommonsCommitments();
  } catch {
    commonsAvailable = false;
    warnings.push("Commons commitments could not be loaded.");
  }

  return {
    status: toDeskStatus(snapshot),
    rpcConfigured: rpcOk,
    walletAddress: snapshot.treasuryAddress,
    walletShort: shortenWallet(snapshot.treasuryAddress),
    explorerUrl: robinhoodAddressExplorerUrl(snapshot.treasuryAddress),
    observedAt: snapshot.observedAt,
    assets,
    commons,
    commonsAvailable,
    warnings: [...new Set(warnings)],
    serverNow: new Date().toISOString(),
  };
}
