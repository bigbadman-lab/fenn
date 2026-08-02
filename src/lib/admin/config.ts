import {
  isWalletInEvmAllowlist,
  parseEvmWalletAllowlist,
} from "@/lib/wallet/allowlist";

/**
 * Parse FENN_ADMIN_WALLETS (comma-separated EVM addresses).
 * Trims whitespace, ignores empty entries, normalizes to lowercase 0x…,
 * and fails loudly on any invalid configured address.
 */
export function parseAdminWalletAllowlist(
  raw: string | null | undefined,
): string[] {
  return parseEvmWalletAllowlist(raw, "FENN_ADMIN_WALLETS");
}

export function isWalletInAdminAllowlist(
  walletAddress: string,
  allowlist: readonly string[],
): boolean {
  return isWalletInEvmAllowlist(walletAddress, allowlist);
}
