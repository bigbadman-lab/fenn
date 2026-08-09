/**
 * Trusted economic recipient resolution (Stage P1B).
 *
 * Does NOT parse 0x from X text.
 * Live X → profile wallet mapping is not available in product tables yet.
 * P1B harness may inject an explicit pre-bound trusted wallet.
 */

import { parseEvmAddress } from "@/lib/wallet/evm";

export type TrustedRecipientResolution =
  | {
      ok: true;
      walletAddress: string;
      source: "p1b_harness_bound" | "trusted_profile_wallet";
    }
  | {
      ok: false;
      reason:
        | "no_mapping"
        | "invalid_wallet"
        | "text_not_trusted"
        | "not_available_live";
    };

/**
 * Product limitation: there is no durable X snowflake → profiles.wallet_address
 * join safe for live transfers. Handle-based joins are not treated as trusted.
 */
export function liveXAuthorHasTrustedWalletMapping(): boolean {
  return false;
}

/**
 * Resolve transfer recipient for authority.
 * Model never supplies address; harness may pre-bind one.
 */
export function resolveTrustedTransferRecipient(input: {
  /** Operator/harness explicit bind only. */
  harnessBoundWallet?: string | null;
  /** Never used as trust source — retained for audit/deny. */
  xBody?: string | null;
  authorXUserId?: string | null;
}): TrustedRecipientResolution {
  if (input.harnessBoundWallet?.trim()) {
    try {
      const walletAddress = parseEvmAddress(input.harnessBoundWallet);
      return {
        ok: true,
        walletAddress,
        source: "p1b_harness_bound",
      };
    } catch {
      return { ok: false, reason: "invalid_wallet" };
    }
  }

  // Live product path: no X identity → verified wallet mapping exists.
  return { ok: false, reason: "not_available_live" };
}

/**
 * Prefer parsing addresses from X text is always fail-closed (not trusted).
 */
export function extractUntrustedAddressFromText(_body: string): null {
  return null;
}
