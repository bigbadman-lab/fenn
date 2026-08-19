/** Public Solana wallets shown on `/commons`. */
export const COMMONS_PUBLIC_TREASURY_WALLET =
  "5tBijfnYVhGsE5SZY1p6JDRNPGudcj7nsd335da9pCaX" as const;

export const COMMONS_PUBLIC_PURSE_WALLET =
  "GeRmuG3vYLyTAaDNWff4yYPxJH7cBmDuVeZ9iV49qdPT" as const;

export const SOLANA_EXPLORER_ACCOUNT_BASE =
  "https://solscan.io/account" as const;

export const SOLANA_EXPLORER_TX_BASE = "https://solscan.io/tx" as const;

export function solanaAccountExplorerUrl(address: string): string {
  return `${SOLANA_EXPLORER_ACCOUNT_BASE}/${address}`;
}

export function solanaTxExplorerUrl(signature: string): string {
  return `${SOLANA_EXPLORER_TX_BASE}/${signature}`;
}
