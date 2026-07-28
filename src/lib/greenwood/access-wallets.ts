import "server-only";

import {
  isNormalizedEvmAddress,
  normalizeEvmAddress,
} from "@/lib/wallet/evm";

/**
 * Parse GREENWOOD_ACCESS_WALLETS (comma-separated EVM addresses).
 * Trims whitespace, ignores empty/malformed entries, normalizes to lowercase 0x…,
 * and de-duplicates. Never throws for bad entries.
 */
export function parseGreenwoodAccessWallets(
  raw: string | null | undefined,
): string[] {
  if (raw == null) return [];

  const allowlist: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;

    const normalized = normalizeEvmAddress(trimmed);
    if (!isNormalizedEvmAddress(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    allowlist.push(normalized);
  }

  return allowlist;
}

export function isWalletInGreenwoodAccessAllowlist(
  walletAddress: string,
  allowlist: readonly string[],
): boolean {
  const normalized = normalizeEvmAddress(walletAddress);
  if (!isNormalizedEvmAddress(normalized)) return false;
  return allowlist.includes(normalized);
}

/**
 * Resolve whether a trusted profile wallet is on the server-only access allowlist.
 * Reads GREENWOOD_ACCESS_WALLETS from env at call time (tests can stub process.env).
 */
export function profileHasGreenwoodAccessOverride(
  walletAddress: string,
  rawEnv: string | null | undefined = process.env.GREENWOOD_ACCESS_WALLETS,
): boolean {
  const allowlist = parseGreenwoodAccessWallets(rawEnv);
  return isWalletInGreenwoodAccessAllowlist(walletAddress, allowlist);
}
