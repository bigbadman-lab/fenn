import {
  normalizeSolanaAddress,
  solanaAddressesEqual,
} from "@/lib/wallet/solana";

/**
 * Wallet ownership surface for /outlaw.
 *
 * Embedded identification order (client boundary):
 * 1. Prefer Privy's official `getEmbeddedConnectedWallet(wallets)` result.
 * 2. When multi-wallet or the helper returns a non-profile address, match the
 *    profile address against wallets using the same criteria the helper uses
 *    (walletClientType === "privy", connectorType === "embedded", !imported) —
 *    taken from Privy SDK `getEmbeddedConnectedWallet` source.
 * 3. Never infer from address format alone.
 * 4. Never export unless profile address is confirmed embedded.
 *
 * Prefer calling getEmbeddedConnectedWallet from the UI boundary.
 * Export only when the profile address is confirmed embedded.
 * Never send secret material through FENN.
 */

export type ConnectedWalletLike = {
  address: string;
  walletClientType?: string;
  connectorType?: string;
  imported?: boolean;
};

export type ProfileWalletKind = "embedded" | "external" | "pending";

export type ProfileWalletPresentation = {
  /** Normalised profile wallet address. */
  address: string;
  kind: ProfileWalletKind;
  /** True only when the profile wallet is confirmed Privy embedded. */
  canExport: boolean;
  /**
   * Address to pass to `exportWallet({ address })`.
   * Always equals `address` when canExport; otherwise null so callers
   * cannot accidentally export a different linked wallet.
   */
  exportAddress: string | null;
};

/**
 * Criteria used by Privy `getEmbeddedConnectedWallet` for the primary
 * non-imported embedded connected wallet.
 */
export function matchesPrivyEmbeddedConnectedWallet(
  wallet: ConnectedWalletLike,
): boolean {
  return (
    wallet.walletClientType === "privy" &&
    wallet.connectorType === "embedded" &&
    wallet.imported !== true
  );
}

/**
 * Resolve how /outlaw should present the stored FENN profile wallet.
 *
 * Only the profile address is eligible for display/export. Linked wallets
 * that are not the profile mark are ignored for export.
 */
export function resolveProfileWalletPresentation(input: {
  profileAddress: string;
  /** Address from `getEmbeddedConnectedWallet(wallets)`, or null. */
  embeddedConnectedAddress: string | null;
  connectedWallets: ConnectedWalletLike[];
  /** When false, wallet connectors are not ready — do not claim external yet. */
  walletsReady: boolean;
}): ProfileWalletPresentation {
  const address = normalizeSolanaAddress(input.profileAddress);

  if (!address) {
    return {
      address: "",
      kind: "pending",
      canExport: false,
      exportAddress: null,
    };
  }

  const officialEmbedded = input.embeddedConnectedAddress
    ? normalizeSolanaAddress(input.embeddedConnectedAddress)
    : null;

  // Primary: official SDK helper points at the profile wallet.
  if (officialEmbedded && solanaAddressesEqual(officialEmbedded, address)) {
    return {
      address,
      kind: "embedded",
      canExport: true,
      exportAddress: address,
    };
  }

  // Multi-wallet / multi-HD: profile may be a non-primary embedded wallet.
  // Apply the same connector signature the helper uses, but for this address.
  const profileConnected = input.connectedWallets.find((wallet) =>
    solanaAddressesEqual(wallet.address, address),
  );

  if (profileConnected && matchesPrivyEmbeddedConnectedWallet(profileConnected)) {
    return {
      address,
      kind: "embedded",
      canExport: true,
      exportAddress: address,
    };
  }

  if (!input.walletsReady) {
    return {
      address,
      kind: "pending",
      canExport: false,
      exportAddress: null,
    };
  }

  // Ready: either missing from connected list, or connected as external.
  // Only profile wallet is shown; export stays off.
  return {
    address,
    kind: "external",
    canExport: false,
    exportAddress: null,
  };
}
