import "server-only";

import { PrivyClient, type LinkedAccount } from "@privy-io/node";

import { publicEnv } from "@/lib/env/public";
import { serverEnv } from "@/lib/env/server";
import {
  isNormalizedEvmAddress,
  normalizeEvmAddress,
} from "@/lib/wallet/evm";

export type VerifiedPrivyWallet = {
  address: string;
  walletClientType?: string;
};

export type VerifiedPrivyIdentity = {
  privyUserId: string;
  wallets: VerifiedPrivyWallet[];
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

function extractEvmWallets(linkedAccounts: LinkedAccount[]): VerifiedPrivyWallet[] {
  const wallets: VerifiedPrivyWallet[] = [];
  const seen = new Set<string>();

  for (const account of linkedAccounts) {
    if (account.type !== "wallet") continue;
    if (!("chain_type" in account) || account.chain_type !== "ethereum") continue;
    if (!("address" in account) || typeof account.address !== "string") continue;

    const address = normalizeEvmAddress(account.address);
    if (!isNormalizedEvmAddress(address)) continue;
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

  return {
    privyUserId: user.id,
    wallets: extractEvmWallets(user.linked_accounts ?? []),
  };
}

export function assertWalletOwnedByIdentity(
  identity: VerifiedPrivyIdentity,
  walletAddress: string,
): string {
  const normalized = normalizeEvmAddress(walletAddress);
  if (!isNormalizedEvmAddress(normalized)) {
    throw new AuthError("Invalid wallet address", 400);
  }

  const owned = identity.wallets.some((wallet) => wallet.address === normalized);
  if (!owned) {
    throw new AuthError(
      "Wallet is not among the authenticated Privy user's verified EVM wallets",
      400,
    );
  }

  return normalized;
}
