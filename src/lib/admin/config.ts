import {
  isWalletInSolanaAllowlist,
  parseSolanaWalletAllowlist,
} from "@/lib/wallet/allowlist";

/**
 * Parse FENN_ADMIN_WALLETS (comma-separated Solana addresses).
 * Trims whitespace, ignores empty entries, preserves base58 casing,
 * and fails loudly on any invalid configured address.
 */
export function parseAdminWalletAllowlist(
  raw: string | null | undefined,
): string[] {
  return parseSolanaWalletAllowlist(raw, "FENN_ADMIN_WALLETS");
}

export function isWalletInAdminAllowlist(
  walletAddress: string,
  allowlist: readonly string[],
): boolean {
  return isWalletInSolanaAllowlist(walletAddress, allowlist);
}
