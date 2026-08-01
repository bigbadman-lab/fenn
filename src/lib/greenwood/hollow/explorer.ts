import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";

/**
 * Approved explorer bases for Hollow on-chain rewards.
 * Unknown chains return null — never build URLs from untrusted input.
 */
const TX_EXPLORER_BY_CHAIN: Readonly<Record<number, string>> = {
  1: "https://etherscan.io/tx/",
  8453: "https://basescan.org/tx/",
  [ROBINHOOD_CHAIN_ID]: "https://explorer.robinhood.com/tx/",
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

export function shortenWallet(address: string | null | undefined): string | null {
  if (!address) return null;
  const a = address.trim();
  if (a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
