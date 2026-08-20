import "server-only";

import { PrivyClient, type LinkedAccount } from "@privy-io/node";

import { publicEnv } from "@/lib/env/public";
import { serverEnv } from "@/lib/env/server";
import {
  isNormalizedSolanaAddress,
  normalizeSolanaAddress,
  solanaAddressesEqual,
} from "@/lib/wallet/solana";

export type VerifiedPrivyWallet = {
  address: string;
  walletClientType?: string;
};

export type VerifiedPrivyIdentity = {
  privyUserId: string;
  wallets: VerifiedPrivyWallet[];
  /** Normalised (lowercase) verified email linked accounts. */
  emails: string[];
};

let privyClient: PrivyClient | null = null;

function getPrivyClient() {
  if (!privyClient) {
    privyClient = new PrivyClient({
      appId: publicEnv.NEXT_PUBLIC_PRIVY_APP_ID,
      appSecret: serverEnv.PRIVY_APP_SECRET,
    });
  }
  return privyClient;
}

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function extractBearerToken(authorizationHeader: string | null): string {
  if (!authorizationHeader) {
    throw new AuthError("Missing Authorization header");
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new AuthError("Invalid Authorization header");
  }

  return token.trim();
}

function extractSolanaWallets(
  linkedAccounts: LinkedAccount[],
): VerifiedPrivyWallet[] {
  const wallets: VerifiedPrivyWallet[] = [];
  const seen = new Set<string>();

  for (const account of linkedAccounts) {
    if (account.type !== "wallet") continue;
    if (!("chain_type" in account) || account.chain_type !== "solana") continue;
    if (!("address" in account) || typeof account.address !== "string") continue;

    const address = normalizeSolanaAddress(account.address);
    if (!isNormalizedSolanaAddress(address)) continue;
    if (seen.has(address)) continue;

    seen.add(address);
    wallets.push({
      address,
      walletClientType:
        "wallet_client_type" in account &&
        typeof account.wallet_client_type === "string"
          ? account.wallet_client_type
          : undefined,
    });
  }

  return wallets;
}

function extractVerifiedEmails(linkedAccounts: LinkedAccount[]): string[] {
  const emails: string[] = [];
  const seen = new Set<string>();

  for (const account of linkedAccounts) {
    if (account.type !== "email") continue;
    if (!("address" in account) || typeof account.address !== "string") continue;

    const email = account.address.trim().toLowerCase();
    if (!email.includes("@")) continue;
    if (seen.has(email)) continue;

    seen.add(email);
    emails.push(email);
  }

  return emails;
}

/**
 * Verify Privy access token, then load the verified user (incl. linked wallets)
 * via the Privy API using the token subject. No identity token required.
 */
export async function getVerifiedPrivyUser(request: Request): Promise<VerifiedPrivyIdentity> {
  const accessToken = extractBearerToken(request.headers.get("authorization"));
  const privy = getPrivyClient();

  let accessClaims;
  try {
    accessClaims = await privy.utils().auth().verifyAccessToken(accessToken);
  } catch {
    throw new AuthError("Invalid or expired Privy access token");
  }

  let user;
  try {
    user = await privy.users()._get(accessClaims.user_id);
  } catch {
    throw new AuthError("Failed to load verified Privy user");
  }

  if (!user?.id || user.id !== accessClaims.user_id) {
    throw new AuthError("Privy user subject mismatch");
  }

  const linkedAccounts = user.linked_accounts ?? [];

  return {
    privyUserId: user.id,
    wallets: extractSolanaWallets(linkedAccounts),
    emails: extractVerifiedEmails(linkedAccounts),
  };
}

export function assertWalletOwnedByIdentity(
  identity: VerifiedPrivyIdentity,
  walletAddress: string,
): string {
  const normalized = normalizeSolanaAddress(walletAddress);
  if (!isNormalizedSolanaAddress(normalized)) {
    throw new AuthError("Invalid wallet address", 400);
  }

  const owned = identity.wallets.some((wallet) =>
    solanaAddressesEqual(wallet.address, normalized),
  );
  if (!owned) {
    throw new AuthError(
      "Wallet is not among the authenticated Privy user's verified Solana wallets",
      400,
    );
  }

  return normalized;
}
