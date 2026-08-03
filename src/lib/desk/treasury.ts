import "server-only";

import { getCommonsCommitments } from "@/lib/commons/commitments";
import type { PublicCommonsCommitment } from "@/lib/commons/types";
import {
  robinhoodAddressExplorerUrl,
  shortenWallet,
} from "@/lib/greenwood/hollow/explorer";
import {
  getOfficialFennTokenLookup,
} from "@/lib/treasury/official-token";
import { getPublicTreasurySnapshot } from "@/lib/treasury/snapshot";
import type {
  OfficialFennTokenLookup,
  PublicTreasurySnapshot,
} from "@/lib/treasury/types";
import { abbreviateEvmAddress } from "@/lib/wallet/evm";

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

export type DeskOfficialFennToken = {
  status: "not_configured" | "configured" | "needs_attention";
  contractAddress: string | null;
  contractShort: string | null;
  explorerUrl: string | null;
  detail: string | null;
};

export type DeskTreasurySnapshot = {
  status: DeskTreasuryStatus;
  rpcConfigured: boolean;
  walletAddress: string | null;
  walletShort: string | null;
  explorerUrl: string | null;
  observedAt: string | null;
  assets: DeskTreasuryAsset[];
  officialFenn: DeskOfficialFennToken;
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

function deskOfficialFromLookup(
  lookup: OfficialFennTokenLookup,
): DeskOfficialFennToken {
  if (lookup.status === "none") {
    return {
      status: "not_configured",
      contractAddress: null,
      contractShort: null,
      explorerUrl: null,
      detail: "not configured",
    };
  }
  if (lookup.status === "ok") {
    const address = lookup.token.contractAddress;
    return {
      status: "configured",
      contractAddress: address,
      contractShort: abbreviateEvmAddress(address),
      explorerUrl: robinhoodAddressExplorerUrl(address),
      detail: "tracked · public",
    };
  }
  return {
    status: "needs_attention",
    contractAddress: null,
    contractShort: null,
    explorerUrl: null,
    detail: "CONTRACT CONFIGURATION NEEDS ATTENTION",
  };
}

export async function getDeskTreasurySnapshot(): Promise<DeskTreasurySnapshot> {
  const snapshot = await getPublicTreasurySnapshot();
  const warnings: string[] = [];
  const rpcOk = rpcConfigured();
  if (!rpcOk) warnings.push("RPC is not configured.");

  let officialFenn: DeskOfficialFennToken;
  try {
    const lookup = await getOfficialFennTokenLookup();
    officialFenn = deskOfficialFromLookup(lookup);
    if (lookup.status === "ambiguous") {
      warnings.push(
        "Official FENN contract is ambiguous — multiple public official rows.",
      );
    } else if (lookup.status === "invalid") {
      warnings.push(
        `Official FENN contract is invalid (${lookup.reason}).`,
      );
    }
  } catch {
    officialFenn = {
      status: "needs_attention",
      contractAddress: null,
      contractShort: null,
      explorerUrl: null,
      detail: "CONTRACT CONFIGURATION NEEDS ATTENTION",
    };
    warnings.push("Official FENN contract could not be loaded.");
  }

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
      officialFenn,
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
    officialFenn,
    commons,
    commonsAvailable,
    warnings: [...new Set(warnings)],
    serverNow: new Date().toISOString(),
  };
}
