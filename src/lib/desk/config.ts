import {
  isWalletInEvmAllowlist,
  parseEvmWalletAllowlist,
} from "@/lib/wallet/allowlist";

/**
 * Parse FENN_DESK_WALLETS (comma-separated EVM addresses).
 * Strict / fail-loud — same rules as admin allowlists.
 * Empty or missing → no Desk access.
 */
export function parseDeskWalletAllowlist(
  raw: string | null | undefined,
): string[] {
  return parseEvmWalletAllowlist(raw, "FENN_DESK_WALLETS");
}

export function isWalletInDeskAllowlist(
  walletAddress: string,
  allowlist: readonly string[],
): boolean {
  return isWalletInEvmAllowlist(walletAddress, allowlist);
}
