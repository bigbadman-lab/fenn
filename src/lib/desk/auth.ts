import "server-only";

import {
  AuthError,
  getVerifiedPrivyUser,
  type VerifiedPrivyIdentity,
} from "@/lib/auth/get-verified-privy-user";
import {
  parseDeskEmailAllowlist,
  parseDeskWalletAllowlist,
} from "@/lib/desk/config";
import {
  evaluateDeskAccess,
  type DeskAccessReason,
} from "@/lib/desk/evaluate";
import { serverEnv } from "@/lib/env/server";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export type { DeskAccessReason, DeskAccessEvaluation } from "@/lib/desk/evaluate";
export { evaluateDeskAccess } from "@/lib/desk/evaluate";

export type FennDeskIdentity = {
  profileId: string;
  privyUserId: string;
  /** Authoritative stored wallet — server use only; never send to clients. */
  walletAddress: string;
  actorId: string;
  outlawAlias: string | null;
  outlawNumber: number;
};

export class DeskAuthError extends Error {
  status: 401 | 403 | 500;
  reason: DeskAccessReason;

  constructor(
    message: string,
    status: 401 | 403 | 500,
    reason: DeskAccessReason,
  ) {
    super(message);
    this.name = "DeskAuthError";
    this.status = status;
    this.reason = reason;
  }
}

export function fennDeskActorId(profileId: string): string {
  return `profile:${profileId}`;
}

function readDeskWalletAllowlist(rawOverride?: string | null): string[] {
  const raw =
    rawOverride !== undefined ? rawOverride : serverEnv.FENN_DESK_WALLETS;
  try {
    return parseDeskWalletAllowlist(raw);
  } catch {
    throw new DeskAuthError(
      "Desk allowlist configuration is invalid",
      500,
      "configuration_error",
    );
  }
}

function readDeskEmailAllowlist(rawOverride?: string | null): string[] {
  const raw =
    rawOverride !== undefined ? rawOverride : serverEnv.FENN_DESK_EMAILS;
  try {
    return parseDeskEmailAllowlist(raw);
  } catch {
    throw new DeskAuthError(
      "Desk allowlist configuration is invalid",
      500,
      "configuration_error",
    );
  }
}

export type RequireFennDeskAccessOptions = {
  /**
   * Raw wallet allowlist string for tests. When omitted, uses serverEnv.FENN_DESK_WALLETS.
   * Never log this value.
   */
  allowlistRaw?: string | null;
  /**
   * Raw email allowlist string for tests. When omitted, uses serverEnv.FENN_DESK_EMAILS.
   * Never log this value.
   */
  emailAllowlistRaw?: string | null;
};

/**
 * Require authenticated Privy identity + registered FENN profile authorised
 * for The Desk via server-only allowlists:
 * - FENN_DESK_WALLETS (profile Solana wallet), or
 * - FENN_DESK_EMAILS (verified Privy email)
 *
 * Never trusts wallet/email flags from the request body, query, or client claims.
 * Independent of FENN_ADMIN_WALLETS and GREENWOOD_ACCESS_WALLETS.
 *
 * 401 — missing/invalid Privy session
 * 403 — authenticated but not authorised for The Desk
 * 500 — invalid Desk allowlist configuration (fail closed)
 */
export async function requireFennDeskAccess(
  request: Request,
  options?: RequireFennDeskAccessOptions,
): Promise<FennDeskIdentity> {
  let identity: VerifiedPrivyIdentity;
  try {
    identity = await getVerifiedPrivyUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      throw new DeskAuthError("Not authenticated", 401, "unauthenticated");
    }
    throw error;
  }

  const admin = createAdminClient();
  const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);
  const walletAllowlist = readDeskWalletAllowlist(options?.allowlistRaw);
  const emailAllowlist = readDeskEmailAllowlist(options?.emailAllowlistRaw);
  const evaluation = evaluateDeskAccess({
    identity,
    profile,
    walletAllowlist,
    emailAllowlist,
  });

  if (!evaluation.ok) {
    throw new DeskAuthError(
      evaluation.reason === "unauthenticated"
        ? "Not authenticated"
        : "Not authorized",
      evaluation.status,
      evaluation.reason,
    );
  }

  if (!profile) {
    throw new DeskAuthError("Not authorized", 403, "profile_required");
  }

  return {
    profileId: profile.id,
    privyUserId: identity.privyUserId,
    walletAddress: evaluation.walletAddress,
    actorId: fennDeskActorId(profile.id),
    outlawAlias: profile.alias,
    outlawNumber: profile.outlaw_number,
  };
}
