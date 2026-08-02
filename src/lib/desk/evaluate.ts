import { isWalletInDeskAllowlist } from "@/lib/desk/config";
import {
  isNormalizedEvmAddress,
  normalizeEvmAddress,
} from "@/lib/wallet/evm";

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
};

export type DeskEvalProfile = {
  wallet_address: string;
};

/**
 * Pure Desk gate over already-resolved identity + profile + allowlist.
 * Never accepts a client-supplied wallet — only profiles.wallet_address.
 */
export function evaluateDeskAccess(input: {
  identity: DeskEvalIdentity | null;
  profile: DeskEvalProfile | null;
  allowlist: readonly string[];
}): DeskAccessEvaluation {
  if (!input.identity) {
    return { ok: false, reason: "unauthenticated", status: 401 };
  }

  if (!input.profile) {
    return { ok: false, reason: "profile_required", status: 403 };
  }

  const walletAddress = normalizeEvmAddress(input.profile.wallet_address);
  if (!isNormalizedEvmAddress(walletAddress)) {
    return { ok: false, reason: "desk_not_allowed", status: 403 };
  }

  const owned = input.identity.wallets.some(
    (wallet) => normalizeEvmAddress(wallet.address) === walletAddress,
  );
  if (!owned) {
    return { ok: false, reason: "wallet_not_owned", status: 403 };
  }

  if (!isWalletInDeskAllowlist(walletAddress, input.allowlist)) {
    return { ok: false, reason: "desk_not_allowed", status: 403 };
  }

  return { ok: true, walletAddress };
}
