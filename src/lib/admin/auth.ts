import "server-only";

import {
  AuthError,
  assertWalletOwnedByIdentity,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import {
  isWalletInAdminAllowlist,
  parseAdminWalletAllowlist,
} from "@/lib/admin/config";
import { serverEnv } from "@/lib/env/server";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isNormalizedEvmAddress,
  normalizeEvmAddress,
} from "@/lib/wallet/evm";

/**
 * Verified FENN admin identity for future privileged routes.
 *
 * actorId maps into:
 * - deed_submissions.reviewed_by_actor_id
 * - admin_audit_log.actor_id (actor_type: "admin")
 *
 * Format: `profile:<uuid>` — stable profile anchor, not a client-supplied flag.
 */
export type FennAdminIdentity = {
  profileId: string;
  privyUserId: string;
  walletAddress: string;
  actorId: string;
};

export class AdminAuthError extends Error {
  status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

export function fennAdminActorId(profileId: string): string {
  return `profile:${profileId}`;
}

/**
 * Future audit inserts should use:
 *   actor_id: identity.actorId  (profile:<uuid>)
 *   actor_type: "admin"
 * Do not write audit events until a real admin action exists.
 */
export type AdminAuditActorFields = {
  actor_id: string;
  actor_type: "admin";
};

export function toAdminAuditActorFields(
  identity: FennAdminIdentity,
): AdminAuditActorFields {
  return {
    actor_id: identity.actorId,
    actor_type: "admin",
  };
}

function getConfiguredAdminAllowlist(): string[] {
  return parseAdminWalletAllowlist(serverEnv.FENN_ADMIN_WALLETS);
}

/**
 * Require authenticated Privy identity + registered FENN profile whose
 * permanent EVM wallet is on the server-only FENN_ADMIN_WALLETS allowlist.
 *
 * 401 — missing/invalid Privy session
 * 403 — authenticated but not an authorized FENN admin
 *
 * Never trusts wallet/admin flags from the request body.
 */
export async function requireFennAdmin(
  request: Request,
): Promise<FennAdminIdentity> {
  let identity;
  try {
    identity = await getVerifiedPrivyUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      throw new AdminAuthError("Not authenticated", 401);
    }
    throw error;
  }

  const admin = createAdminClient();
  const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);

  if (!profile) {
    throw new AdminAuthError("Not authorized", 403);
  }

  const walletAddress = normalizeEvmAddress(profile.wallet_address);
  if (!isNormalizedEvmAddress(walletAddress)) {
    throw new AdminAuthError("Not authorized", 403);
  }

  try {
    assertWalletOwnedByIdentity(identity, walletAddress);
  } catch {
    throw new AdminAuthError("Not authorized", 403);
  }

  const allowlist = getConfiguredAdminAllowlist();
  if (!isWalletInAdminAllowlist(walletAddress, allowlist)) {
    throw new AdminAuthError("Not authorized", 403);
  }

  return {
    profileId: profile.id,
    privyUserId: identity.privyUserId,
    walletAddress,
    actorId: fennAdminActorId(profile.id),
  };
}
