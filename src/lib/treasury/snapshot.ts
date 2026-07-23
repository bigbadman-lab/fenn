import "server-only";

import { listTrackedTreasuryAssetRows } from "@/lib/treasury/assets";
import {
  toTrackedAsset,
  type TreasuryAssetRow,
} from "@/lib/treasury/asset-map";
import {
  createRobinhoodPublicClient,
  readErc20Balance,
  readNativeBalance,
  type RobinhoodPublicClient,
} from "@/lib/treasury/chain";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { getTreasuryConfig } from "@/lib/treasury/config";
import { getVerifiedTreasuryContributions } from "@/lib/treasury/contributions-query";
import { TreasuryError } from "@/lib/treasury/errors";
import type {
  PublicTreasuryAssetRead,
  PublicTreasuryContribution,
  PublicTreasurySnapshot,
  TreasuryAmount,
  TreasuryConfigState,
  TreasuryTrackedAsset,
} from "@/lib/treasury/types";

export type TreasurySnapshotDeps = {
  getConfig: () => Promise<TreasuryConfigState>;
  listAssetRows: () => Promise<TreasuryAssetRow[]>;
  getContributions: () => Promise<PublicTreasuryContribution[]>;
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

const defaultDeps: TreasurySnapshotDeps = {
  getConfig: () => getTreasuryConfig(),
  listAssetRows: () => listTrackedTreasuryAssetRows(),
  getContributions: () => getVerifiedTreasuryContributions(),
  createClient: () => createRobinhoodPublicClient(),
  readNative: readNativeBalance,
  readErc20: readErc20Balance,
  now: () => new Date(),
};

function baseAssetFields(asset: {
  symbol: string;
  name: string | null;
  chainId: number;
  contractAddress: string | null;
  decimals: number;
}): Pick<
  PublicTreasuryAssetRead,
  "symbol" | "name" | "chainId" | "contractAddress" | "decimals"
> {
  return {
    symbol: asset.symbol,
    name: asset.name,
    chainId: asset.chainId,
    contractAddress: asset.contractAddress,
    decimals: asset.decimals,
  };
}

function unavailableAsset(
  asset: {
    symbol: string;
    name: string | null;
    chainId: number;
    contractAddress: string | null;
    decimals: number;
  },
  reason: "rpc_failed" | "configuration_error",
): PublicTreasuryAssetRead {
  return {
    ...baseAssetFields(asset),
    state: "unavailable",
    reason,
  };
}

/**
 * Resolve a tracked asset row into either a valid tracked asset or a
 * configuration_error public read (without querying the chain).
 */
function resolveTrackedAsset(row: TreasuryAssetRow):
  | { ok: true; asset: TreasuryTrackedAsset }
  | { ok: false; read: PublicTreasuryAssetRead } {
  try {
    return { ok: true, asset: toTrackedAsset(row) };
  } catch (error) {
    if (
      error instanceof TreasuryError &&
      (error.code === "treasury_asset_chain_mismatch" ||
        error.code === "treasury_invalid_token_address" ||
        error.code === "treasury_config_failed")
    ) {
      return {
        ok: false,
        read: unavailableAsset(
          {
            symbol: row.symbol,
            name: row.name,
            chainId: row.chain_id,
            contractAddress: row.contract_address,
            decimals: Number.isFinite(row.decimals) ? row.decimals : 0,
          },
          "configuration_error",
        ),
      };
    }
    throw error;
  }
}

async function readOneAsset(
  asset: TreasuryTrackedAsset,
  treasuryAddress: string,
  client: RobinhoodPublicClient,
  deps: TreasurySnapshotDeps,
): Promise<PublicTreasuryAssetRead> {
  // Defense in depth — never query off-chain assets.
  if (asset.chainId !== ROBINHOOD_CHAIN_ID) {
    return unavailableAsset(asset, "configuration_error");
  }

  try {
    const amount =
      asset.contractAddress == null
        ? await deps.readNative(treasuryAddress, client)
        : await deps.readErc20({
            tokenAddress: asset.contractAddress,
            holder: treasuryAddress,
            decimals: asset.decimals,
            client,
          });

    return {
      ...baseAssetFields(asset),
      state: "available",
      balance: amount.formatted,
    };
  } catch {
    return unavailableAsset(asset, "rpc_failed");
  }
}

/**
 * Authoritative public Treasury snapshot.
 *
 * Holdings come only from live Robinhood Chain balances for the DB
 * canonical Treasury wallet. Contribution rows are annotations only.
 *
 * No mutation. No Commons math. No Circulation totals.
 */
export async function getPublicTreasurySnapshot(
  overrides?: Partial<TreasurySnapshotDeps>,
): Promise<PublicTreasurySnapshot> {
  const deps: TreasurySnapshotDeps = { ...defaultDeps, ...overrides };

  const config = await deps.getConfig();
  if (!config.configured) {
    return { state: "unconfigured" };
  }

  const treasuryAddress = config.walletAddress;
  const observedAt = deps.now().toISOString();

  const [assetRows, contributions] = await Promise.all([
    deps.listAssetRows(),
    deps.getContributions().catch((error: unknown) => {
      // Soft-fail annotations so a contributions query outage does not
      // erase live holdings.
      if (error instanceof TreasuryError) {
        console.error(
          "[treasury] verified contributions unavailable",
          error.code,
        );
        return [] as PublicTreasuryContribution[];
      }
      throw error;
    }),
  ]);

  type Slot =
    | { kind: "config_error"; read: PublicTreasuryAssetRead }
    | { kind: "live"; asset: TreasuryTrackedAsset };

  const slots: Slot[] = assetRows.map((row) => {
    const resolved = resolveTrackedAsset(row);
    if (!resolved.ok) {
      return { kind: "config_error", read: resolved.read };
    }
    return { kind: "live", asset: resolved.asset };
  });

  const liveAssets = slots
    .filter((s): s is { kind: "live"; asset: TreasuryTrackedAsset } => s.kind === "live")
    .map((s) => s.asset);

  // Configured but nothing tracked — ready with empty assets.
  if (slots.length === 0) {
    return {
      state: "ready",
      treasuryAddress,
      observedAt,
      assets: [],
      contributions,
    };
  }

  // Only configuration errors — no chain queries.
  if (liveAssets.length === 0) {
    return {
      state: "ready",
      treasuryAddress,
      observedAt,
      assets: slots.map((s) =>
        s.kind === "config_error" ? s.read : unavailableAsset(s.asset, "configuration_error"),
      ),
      contributions,
    };
  }

  let client: RobinhoodPublicClient | null = null;
  let rpcBootstrapFailed = false;
  try {
    client = deps.createClient();
  } catch (error) {
    if (
      error instanceof TreasuryError &&
      error.code === "treasury_rpc_unavailable"
    ) {
      rpcBootstrapFailed = true;
    } else {
      throw error;
    }
  }

  const liveReads = new Map<string, PublicTreasuryAssetRead>();

  if (rpcBootstrapFailed || client == null) {
    for (const asset of liveAssets) {
      liveReads.set(asset.id, unavailableAsset(asset, "rpc_failed"));
    }
  } else {
    const results = await Promise.all(
      liveAssets.map(async (asset) => {
        const read = await readOneAsset(
          asset,
          treasuryAddress,
          client,
          deps,
        );
        return [asset.id, read] as const;
      }),
    );
    for (const [id, read] of results) {
      liveReads.set(id, read);
    }
  }

  const assets: PublicTreasuryAssetRead[] = slots.map((slot) => {
    if (slot.kind === "config_error") return slot.read;
    const read = liveReads.get(slot.asset.id);
    return read ?? unavailableAsset(slot.asset, "rpc_failed");
  });

  const attemptedLive = liveAssets.length;
  const liveFailed = [...liveReads.values()].filter(
    (a) => a.state === "unavailable",
  ).length;
  const allLiveFailed = attemptedLive > 0 && liveFailed === attemptedLive;

  return {
    state: allLiveFailed ? "unavailable" : "ready",
    treasuryAddress,
    observedAt,
    assets,
    contributions,
  };
}
