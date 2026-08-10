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
  /**
   * null for native gas or a pre-launch dormancy placeholder without a CA.
   * Only `isNative` means "read native balance" — null alone is not sufficient.
   */
  contractAddress: string | null;
  decimals: number;
  displayOrder: number;
  /** Canonical Robinhood native (ETH + null CA). Never true for dormant ERC-20. */
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
 * Official public $FENN token asset (server definition).
 * Source: treasury_assets row with trusted metadata flags — not env.
 */
export type OfficialFennTokenAsset = {
  symbol: string;
  name: string | null;
  chainId: number;
  contractAddress: string;
  decimals: number;
};

/** Public safe official-token fields for UI and GET /api/treasury. */
export type PublicOfficialFennToken = {
  symbol: "FENN";
  chainId: number;
  contractAddress: string;
  explorerUrl: string;
};

/** DB candidate row for official-token resolution (includes metadata). */
export type OfficialTokenCandidateRow = {
  id: string;
  symbol: string;
  name: string | null;
  chain_id: number;
  contract_address: string | null;
  decimals: number;
  is_tracked: boolean;
  metadata: Record<string, unknown> | null;
};

export type OfficialFennTokenLookup =
  | { status: "none" }
  | { status: "ok"; token: OfficialFennTokenAsset }
  | { status: "ambiguous"; count: number }
  | {
      status: "invalid";
      reason: "symbol_mismatch" | "invalid_address" | "invalid_decimals";
    };

/**
 * Public Treasury snapshot for Stage 9.2+.
 * Holdings come only from live chain reads — never contribution sums.
 * officialToken is independent of wallet balances (null before launch).
 */
export type PublicTreasurySnapshot =
  | {
      state: "unconfigured";
      officialToken: PublicOfficialFennToken | null;
    }
  | {
      state: "ready";
      treasuryAddress: string;
      observedAt: string;
      assets: PublicTreasuryAssetRead[];
      contributions: PublicTreasuryContribution[];
      officialToken: PublicOfficialFennToken | null;
    }
  | {
      state: "unavailable";
      treasuryAddress: string;
      observedAt: string;
      assets: PublicTreasuryAssetRead[];
      contributions: PublicTreasuryContribution[];
      officialToken: PublicOfficialFennToken | null;
    };
