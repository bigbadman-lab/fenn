import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { TreasuryError } from "@/lib/treasury/errors";
import type { TreasuryTrackedAsset } from "@/lib/treasury/types";
import {
  isNormalizedEvmAddress,
  parseEvmAddress,
} from "@/lib/wallet/evm";

export type TreasuryAssetRow = {
  id: string;
  symbol: string;
  name: string | null;
  chain_id: number;
  contract_address: string | null;
  decimals: number;
  display_order: number;
  is_tracked: boolean;
};

export function toTrackedAsset(row: TreasuryAssetRow): TreasuryTrackedAsset {
  if (row.chain_id !== ROBINHOOD_CHAIN_ID) {
    throw new TreasuryError(
      "treasury_asset_chain_mismatch",
      `Tracked asset ${row.symbol} targets chain ${row.chain_id}; Robinhood Chain is ${ROBINHOOD_CHAIN_ID}`,
      500,
    );
  }

  if (
    !Number.isInteger(row.decimals) ||
    row.decimals < 0 ||
    row.decimals > 255
  ) {
    throw new TreasuryError(
      "treasury_config_failed",
      `Tracked asset ${row.symbol} has invalid decimals`,
      500,
    );
  }

  let contractAddress: string | null = null;
  if (row.contract_address != null) {
    const normalized = row.contract_address.trim().toLowerCase();
    if (!isNormalizedEvmAddress(normalized)) {
      throw new TreasuryError(
        "treasury_invalid_token_address",
        `Tracked asset ${row.symbol} has an invalid contract address`,
        500,
      );
    }
    contractAddress = parseEvmAddress(normalized);
  }

  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    chainId: row.chain_id,
    contractAddress,
    decimals: row.decimals,
    displayOrder: row.display_order,
    isNative: contractAddress == null,
  };
}

/** Assert an asset is valid for Robinhood Chain live reads. */
export function assertAssetOnRobinhoodChain(asset: TreasuryTrackedAsset): void {
  if (asset.chainId !== ROBINHOOD_CHAIN_ID) {
    throw new TreasuryError(
      "treasury_asset_chain_mismatch",
      `Asset ${asset.symbol} is not on Robinhood Chain`,
      500,
    );
  }
  if (
    asset.contractAddress != null &&
    !isNormalizedEvmAddress(asset.contractAddress)
  ) {
    throw new TreasuryError(
      "treasury_invalid_token_address",
      `Asset ${asset.symbol} has an invalid contract address`,
      500,
    );
  }
}
