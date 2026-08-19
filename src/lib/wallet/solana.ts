/** Base58 Solana pubkey (32–44 chars). Case-sensitive. */
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function normalizeSolanaAddress(value: string): string {
  return value.trim();
}

export function isNormalizedSolanaAddress(value: string): boolean {
  return SOLANA_ADDRESS_RE.test(value);
}

/**
 * Normalize and validate a Solana wallet address.
 * Throws if malformed. Preserves base58 casing.
 */
export function parseSolanaAddress(value: string): string {
  const normalized = normalizeSolanaAddress(value);
  if (!isNormalizedSolanaAddress(normalized)) {
    throw new Error("Invalid Solana wallet address");
  }
  return normalized;
}

export function solanaAddressesEqual(a: string, b: string): boolean {
  return normalizeSolanaAddress(a) === normalizeSolanaAddress(b);
}

export function abbreviateSolanaAddress(address: string): string {
  const normalized = normalizeSolanaAddress(address);
  if (!isNormalizedSolanaAddress(normalized)) {
    return address;
  }
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}
