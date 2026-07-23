import {
  isNormalizedEvmAddress,
  normalizeEvmAddress,
} from "@/lib/wallet/evm";

/**
 * Parse FENN_ADMIN_WALLETS (comma-separated EVM addresses).
 * Trims whitespace, ignores empty entries, normalizes to lowercase 0x…,
 * and fails loudly on any invalid configured address.
 */
export function parseAdminWalletAllowlist(
  raw: string | null | undefined,
): string[] {
  if (raw == null) return [];

  const entries = raw.split(",");
  const allowlist: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;

    const normalized = normalizeEvmAddress(trimmed);
    if (!isNormalizedEvmAddress(normalized)) {
      throw new Error(
        `Invalid address in FENN_ADMIN_WALLETS: "${trimmed}"`,
      );
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    allowlist.push(normalized);
  }

  return allowlist;
}

export function isWalletInAdminAllowlist(
  walletAddress: string,
  allowlist: readonly string[],
): boolean {
  const normalized = normalizeEvmAddress(walletAddress);
  if (!isNormalizedEvmAddress(normalized)) return false;
  return allowlist.includes(normalized);
}
