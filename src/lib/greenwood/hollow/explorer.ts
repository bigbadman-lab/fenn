import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";

/**
 * Canonical Robinhood Chain Blockscout base (no trailing slash).
 * Used for address + tx explorer links across Treasury, Commons, Purse, Hollow, Market Watch.
 */
export const ROBINHOOD_CHAIN_EXPLORER_BASE =
  "https://robinhoodchain.blockscout.com" as const;

/**
 * Approved explorer bases for Hollow on-chain rewards.
 * Unknown chains return null — never build URLs from untrusted input.
 */
const TX_EXPLORER_BY_CHAIN: Readonly<Record<number, string>> = {
  1: "https://etherscan.io/tx/",
  8453: "https://basescan.org/tx/",
  [ROBINHOOD_CHAIN_ID]: `${ROBINHOOD_CHAIN_EXPLORER_BASE}/tx/`,
};

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

export function isValidTxHash(hash: string): boolean {
  return TX_HASH_RE.test(hash.trim());
}

export function explorerTxUrl(
  chainId: number | null | undefined,
  txHash: string | null | undefined,
): string | null {
  if (chainId == null || !txHash) return null;
  const base = TX_EXPLORER_BY_CHAIN[chainId];
  if (!base) return null;
  const hash = txHash.trim();
  if (!isValidTxHash(hash)) return null;
  return `${base}${hash}`;
}

const ADDRESS_EXPLORER_BY_CHAIN: Readonly<Record<number, string>> = {
  1: "https://etherscan.io/address/",
  8453: "https://basescan.org/address/",
  [ROBINHOOD_CHAIN_ID]: `${ROBINHOOD_CHAIN_EXPLORER_BASE}/address/`,
};

/**
 * Robinhood Chain address explorer for Desk wallet links.
 * Label callers as Robinhood Chain — not a universal authority.
 */
export function explorerAddressUrl(
  chainId: number | null | undefined,
  address: string | null | undefined,
): string | null {
  if (chainId == null || !address) return null;
  const base = ADDRESS_EXPLORER_BY_CHAIN[chainId];
  if (!base) return null;
  const normalized = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) return null;
  return `${base}${normalized}`;
}

export function robinhoodAddressExplorerUrl(
  address: string | null | undefined,
): string | null {
  return explorerAddressUrl(ROBINHOOD_CHAIN_ID, address);
}

export function shortenWallet(address: string | null | undefined): string | null {
  if (!address) return null;
  const a = address.trim();
  if (a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
