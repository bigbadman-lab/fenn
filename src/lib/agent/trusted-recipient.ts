/**
 * Trusted economic recipient resolution (Stage P1B / P1D).
 *
 * - Model never supplies address as trusted spend destination unsolicited.
 * - Live permanent X → profile wallet mapping is not available for MVP.
 * - P1B harness may inject an explicit pre-bound trusted wallet.
 * - P1D may inject a wallet confirmed for a specific economic_interaction only.
 */

import { parseEvmAddress } from "@/lib/wallet/evm";

export type TrustedRecipientResolution =
  | {
      ok: true;
      walletAddress: string;
      source:
        | "p1b_harness_bound"
        | "trusted_profile_wallet"
        | "economic_interaction";
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
 * Model never supplies address; harness or confirmed interaction may bind one.
 */
export function resolveTrustedTransferRecipient(input: {
  /** Operator/harness explicit bind only. */
  harnessBoundWallet?: string | null;
  /**
   * P1D: wallet confirmed for one economic_interaction.
   * Not permanent identity.
   */
  interactionConfirmedWallet?: string | null;
  /** Never used as trust source for unsolicited spend — retained for audit. */
  xBody?: string | null;
  authorXUserId?: string | null;
}): TrustedRecipientResolution {
  if (input.interactionConfirmedWallet?.trim()) {
    try {
      const walletAddress = parseEvmAddress(input.interactionConfirmedWallet);
      return {
        ok: true,
        walletAddress,
        source: "economic_interaction",
      };
    } catch {
      return { ok: false, reason: "invalid_wallet" };
    }
  }

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

  // Live product path: no permanent X identity → verified wallet mapping.
  return { ok: false, reason: "not_available_live" };
}

/**
 * Prefer parsing addresses from X text is always fail-closed for unsolicited spend.
 * P1D candidate extraction uses wallet-collection.ts under awaiting_wallet only.
 */
export function extractUntrustedAddressFromText(_body: string): null {
  return null;
}
