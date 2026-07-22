const EVM_ADDRESS_RE = /^0x[a-f0-9]{40}$/;

export function normalizeEvmAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isNormalizedEvmAddress(value: string): boolean {
  return EVM_ADDRESS_RE.test(value);
}

/**
 * Normalize and validate a lowercase EVM address.
 * Throws if malformed. Does not apply EIP-55 checksumming.
 */
export function parseEvmAddress(value: string): string {
  const normalized = normalizeEvmAddress(value);
  if (!isNormalizedEvmAddress(normalized)) {
    throw new Error("Invalid EVM wallet address");
  }
  return normalized;
}

export function abbreviateEvmAddress(address: string): string {
  const normalized = normalizeEvmAddress(address);
  if (!isNormalizedEvmAddress(normalized)) {
    return address;
  }
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}
