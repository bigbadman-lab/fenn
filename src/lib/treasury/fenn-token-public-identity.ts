/**
 * P2E — stable public $VELL identity facts for the website.
 *
 * Matches P2D Canon (`fenn.token.identity`). Never includes mint address here.
 * Live mint/contract comes only from getPublicOfficialFennToken / resolveOfficialFennToken.
 */

/** Shared with launch readiness semantics — design identity only. */
export const FENN_TOKEN_PUBLIC_SYMBOL = "VELL" as const;
export const FENN_TOKEN_PUBLIC_TICKER = "$VELL" as const;
export const FENN_TOKEN_PUBLIC_CHAIN_NAME = "SOLANA" as const;
export const FENN_TOKEN_PUBLIC_NETWORK = "mainnet-beta" as const;
export const FENN_TOKEN_PUBLIC_STANDARD = "SPL" as const;
export const FENN_TOKEN_PUBLIC_DECIMALS = 9 as const;
/** Design total supply — not circulating supply or market data. */
export const FENN_TOKEN_PUBLIC_TOTAL_SUPPLY_FORMATTED = "1,000,000,000" as const;
/** Intended initial Purse allocation — not permanent balance. */
export const FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED = "10,000,000" as const;
export const FENN_TOKEN_PUBLIC_INITIAL_PURSE_PCT = "1%" as const;

/** Compact facts for public token identity grids. */
export const FENN_TOKEN_PUBLIC_IDENTITY_ROWS = [
  { label: "TOKEN", value: FENN_TOKEN_PUBLIC_TICKER },
  { label: "CHAIN", value: FENN_TOKEN_PUBLIC_CHAIN_NAME },
  { label: "NETWORK", value: FENN_TOKEN_PUBLIC_NETWORK },
  { label: "STANDARD", value: FENN_TOKEN_PUBLIC_STANDARD },
  { label: "DECIMALS", value: String(FENN_TOKEN_PUBLIC_DECIMALS) },
  {
    label: "TOTAL SUPPLY",
    value: `${FENN_TOKEN_PUBLIC_TOTAL_SUPPLY_FORMATTED} VELL`,
  },
  {
    label: "INITIAL PURSE",
    value: `${FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED} VELL / ${FENN_TOKEN_PUBLIC_INITIAL_PURSE_PCT}`,
  },
] as const;
