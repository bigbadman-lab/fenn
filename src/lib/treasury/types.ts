/**
 * Exact onchain quantity — never pass through JS floating point.
 * `formatted` is a decimal string via viem formatUnits.
 */
export type TreasuryAmount = {
  raw: bigint;
  formatted: string;
  decimals: number;
};

/** Public Treasury wallet identity (no notes / actor IDs). */
export type PublicTreasuryConfig = {
  configured: true;
  walletAddress: string;
};

export type TreasuryConfigState =
  | { configured: false }
  | PublicTreasuryConfig;

/** Tracked asset definition — not a live balance. */
export type TreasuryTrackedAsset = {
  id: string;
  symbol: string;
  name: string | null;
  chainId: number;
  /** null = chain-native asset */
  contractAddress: string | null;
  decimals: number;
  displayOrder: number;
  isNative: boolean;
};

/** Live per-asset read for public Treasury. */
export type PublicTreasuryAssetRead =
  | {
      symbol: string;
      name: string | null;
      chainId: number;
      contractAddress: string | null;
      decimals: number;
      state: "available";
      /** Exact formatted decimal string — never a float. */
      balance: string;
    }
  | {
      symbol: string;
      name: string | null;
      chainId: number;
      contractAddress: string | null;
      decimals: number;
      state: "unavailable";
      reason: "rpc_failed" | "configuration_error";
    };

/** Verified contribution annotation — not holdings authority. */
export type PublicTreasuryContribution = {
  id: string;
  assetSymbol: string;
  amount: string;
  amountRaw: string | null;
  valueUsdAtReceipt: string | null;
  txHash: string | null;
  fromAddress: string | null;
  projectName: string | null;
  purpose: string | null;
  designation: "treasury" | "commons_intent" | "other";
  verifiedAt: string | null;
  createdAt: string;
};

/**
 * Public Treasury snapshot for Stage 9.2+.
 * Holdings come only from live chain reads — never contribution sums.
 */
export type PublicTreasurySnapshot =
  | {
      state: "unconfigured";
    }
  | {
      state: "ready";
      treasuryAddress: string;
      observedAt: string;
      assets: PublicTreasuryAssetRead[];
      contributions: PublicTreasuryContribution[];
    }
  | {
      state: "unavailable";
      treasuryAddress: string;
      observedAt: string;
      assets: PublicTreasuryAssetRead[];
      contributions: PublicTreasuryContribution[];
    };
