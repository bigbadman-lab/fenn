import {
  isEmailInDeskAllowlist,
  isWalletInDeskAllowlist,
} from "@/lib/desk/config";
import {
  isNormalizedSolanaAddress,
  normalizeSolanaAddress,
  solanaAddressesEqual,
} from "@/lib/wallet/solana";

/**
 * Internal Desk access outcomes (deny reasons).
 * Public UI collapses all denials to the quiet Desk surface.
 */
export type DeskAccessReason =
  | "unauthenticated"
  | "profile_required"
  | "wallet_not_owned"
  | "desk_not_allowed"
  | "configuration_error";

export type DeskAccessEvaluation =
  | { ok: true; walletAddress: string }
  | {
      ok: false;
      reason: Exclude<DeskAccessReason, "configuration_error">;
      status: 401 | 403;
    };

/** Minimal identity shape — avoids importing Privy/serverEnv into pure evaluation. */
export type DeskEvalIdentity = {
  wallets: ReadonlyArray<{ address: string }>;
  /** Verified Privy email linked accounts (already normalised lowercase). */
  emails?: ReadonlyArray<string>;
};

export type DeskEvalProfile = {
  wallet_address: string;
};

/**
 * Pure Desk gate over already-resolved identity + profile + allowlists.
 * Never accepts a client-supplied wallet or email — only Privy-verified
 * identity plus profiles.wallet_address.
 *
 * Access when the stored profile wallet is owned by the session and either:
 * - that wallet is on FENN_DESK_WALLETS, or
 * - a verified Privy email is on FENN_DESK_EMAILS.
 */
export function evaluateDeskAccess(input: {
  identity: DeskEvalIdentity | null;
  profile: DeskEvalProfile | null;
  walletAllowlist?: readonly string[];
  emailAllowlist?: readonly string[];
}): DeskAccessEvaluation {
  if (!input.identity) {
    return { ok: false, reason: "unauthenticated", status: 401 };
  }

  if (!input.profile) {
    return { ok: false, reason: "profile_required", status: 403 };
  }

  const walletAddress = normalizeSolanaAddress(input.profile.wallet_address);
  if (!isNormalizedSolanaAddress(walletAddress)) {
    return { ok: false, reason: "desk_not_allowed", status: 403 };
  }

  const owned = input.identity.wallets.some((wallet) =>
    solanaAddressesEqual(wallet.address, walletAddress),
  );
  if (!owned) {
    return { ok: false, reason: "wallet_not_owned", status: 403 };
  }

  const walletAllowlist = input.walletAllowlist ?? [];
  const emailAllowlist = input.emailAllowlist ?? [];

  const walletAllowed = isWalletInDeskAllowlist(walletAddress, walletAllowlist);
  const emailAllowed = (input.identity.emails ?? []).some((email) =>
    isEmailInDeskAllowlist(email, emailAllowlist),
  );

  if (!walletAllowed && !emailAllowed) {
    return { ok: false, reason: "desk_not_allowed", status: 403 };
  }

  return { ok: true, walletAddress };
}
