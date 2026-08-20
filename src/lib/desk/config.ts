import {
  isWalletInSolanaAllowlist,
  parseSolanaWalletAllowlist,
} from "@/lib/wallet/allowlist";

/**
 * Parse FENN_DESK_WALLETS (comma-separated Solana addresses).
 * Strict / fail-loud — same rules as admin allowlists.
 * Empty or missing → no wallet-based Desk access from this list.
 */
export function parseDeskWalletAllowlist(
  raw: string | null | undefined,
): string[] {
  return parseSolanaWalletAllowlist(raw, "FENN_DESK_WALLETS");
}

export function isWalletInDeskAllowlist(
  walletAddress: string,
  allowlist: readonly string[],
): boolean {
  return isWalletInSolanaAllowlist(walletAddress, allowlist);
}

/** Lowercase + trim. Desk email matching is case-insensitive. */
export function normalizeDeskEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Loose structural check — enough to reject clearly bad allowlist entries.
 * Exact membership still uses normalized strings only.
 */
const DESK_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse FENN_DESK_EMAILS (comma-separated emails).
 * Strict / fail-loud. Empty or missing → no email-based Desk access from this list.
 * Never NEXT_PUBLIC_*. Never log allowlist contents to clients.
 */
export function parseDeskEmailAllowlist(
  raw: string | null | undefined,
): string[] {
  if (raw == null) return [];

  const entries = raw.split(",");
  const allowlist: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;

    const normalized = normalizeDeskEmail(trimmed);
    if (!DESK_EMAIL_PATTERN.test(normalized)) {
      throw new Error(`Invalid email in FENN_DESK_EMAILS: "${trimmed}"`);
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    allowlist.push(normalized);
  }

  return allowlist;
}

export function isEmailInDeskAllowlist(
  email: string,
  allowlist: readonly string[],
): boolean {
  const normalized = normalizeDeskEmail(email);
  if (!DESK_EMAIL_PATTERN.test(normalized)) return false;
  return allowlist.includes(normalized);
}
