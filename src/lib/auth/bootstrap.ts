import "server-only";

import type { VerifiedPrivyIdentity } from "@/lib/auth/get-verified-privy-user";
import { getFirstThirtyProgress } from "@/lib/first-thirty/service";
import type { SafeFirstThirtyProgress } from "@/lib/first-thirty/types";
import {
  clearInviteCookie,
  getOutlawInviteMemberSummary,
  processInviteRetryForProfile,
  readInviteCookie,
} from "@/lib/invites";
import type { OutlawInviteMemberSummary } from "@/lib/invites/types";
import {
  findApplicationForProfile,
  findProfileByPrivyUserId,
  profileDto,
  type ProfileRecord,
} from "@/lib/profiles/queries";
import type {
  SafeApplicationSummary,
  SafeProfile,
} from "@/lib/profiles/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Client-safe authenticated bootstrap snapshot. */
export type AuthenticatedWorldBootstrap = {
  authenticated: boolean;
  registered: boolean;
  profile: SafeProfile | null;
  application: SafeApplicationSummary | null;
  wallets: string[];
  firstThirty: SafeFirstThirtyProgress | null;
  inviteSummary: OutlawInviteMemberSummary | null;
  errors: {
    firstThirty: boolean;
    inviteSummary: boolean;
  };
};

export type BootstrapTiming = {
  verifyMs?: number;
  profileMs?: number;
  secondaryMs?: number;
  totalMs: number;
};

function bootstrapTimingEnabled(): boolean {
  if (process.env.FENN_BOOTSTRAP_TIMING === "1") return true;
  if (process.env.FENN_BOOTSTRAP_TIMING === "0") return false;
  return process.env.NODE_ENV === "development";
}

function nowMs(): number {
  return performance.now();
}

/**
 * One Privy identity (already verified) → one profile → parallel critical member state.
 * Does not re-verify Privy. Does not HTTP self-call.
 */
export async function getAuthenticatedWorldBootstrap(
  identity: VerifiedPrivyIdentity,
  options?: { admin?: SupabaseClient },
): Promise<{
  bootstrap: AuthenticatedWorldBootstrap;
  timing: BootstrapTiming;
}> {
  const t0 = nowMs();
  const admin = options?.admin ?? createAdminClient();

  const tProfile0 = nowMs();
  const profileRow = await findProfileByPrivyUserId(
    admin,
    identity.privyUserId,
  );
  const profileMs = nowMs() - tProfile0;

  const wallets = identity.wallets.map((w) => w.address);

  if (!profileRow) {
    const bootstrap: AuthenticatedWorldBootstrap = {
      authenticated: true,
      registered: false,
      profile: null,
      application: null,
      wallets,
      firstThirty: null,
      inviteSummary: null,
      errors: { firstThirty: false, inviteSummary: false },
    };
    return {
      bootstrap,
      timing: { profileMs, totalMs: nowMs() - t0 },
    };
  }

  // Preserve stored wallet anchor — do not rewrite from active Privy wallets.
  const application = await findApplicationForProfile(admin, profileRow.id);
  const safeProfile = profileDto(profileRow);
  const isGreenwoodMember = profileRow.greenwood_entered_at != null;

  // Durable invite retry only (same as /api/auth/me).
  try {
    await processInviteRetryForProfile(profileRow.id, admin);
  } catch (err) {
    console.error("[bootstrap invite retry]", err);
  }

  try {
    const cookieCode = await readInviteCookie();
    if (cookieCode) {
      await clearInviteCookie();
    }
  } catch {
    // ignore cookie edge cases outside request scope
  }

  let firstThirty: SafeFirstThirtyProgress | null = null;
  let inviteSummary: OutlawInviteMemberSummary | null = null;
  let firstThirtyFailed = false;
  let inviteFailed = false;

  const tSecondary0 = nowMs();

  // Greenwood members skip First Thirty journey surface; still load invites.
  const firstThirtyPromise = isGreenwoodMember
    ? Promise.resolve({ ok: true as const, value: null as SafeFirstThirtyProgress | null })
    : getFirstThirtyProgress({
        profileId: profileRow.id,
        isGreenwoodMember: false,
        admin,
      })
        .then((value) => ({ ok: true as const, value }))
        .catch((err: unknown) => {
          console.error("[bootstrap firstThirty]", err);
          return { ok: false as const, value: null };
        });

  const invitePromise = getOutlawInviteMemberSummary({
    profileId: profileRow.id,
    inviteCode: profileRow.invite_code ?? undefined,
    admin,
  })
    .then((value) => ({ ok: true as const, value }))
    .catch((err: unknown) => {
      console.error("[bootstrap inviteSummary]", err);
      return { ok: false as const, value: null };
    });

  const [ftResult, inviteResult] = await Promise.all([
    firstThirtyPromise,
    invitePromise,
  ]);

  if (ftResult.ok) {
    firstThirty = ftResult.value;
  } else {
    firstThirtyFailed = true;
    firstThirty = null;
  }

  if (inviteResult.ok) {
    inviteSummary = inviteResult.value;
    if (inviteSummary == null) {
      // Missing code is soft unavailable, not a hard error
      inviteFailed = true;
    }
  } else {
    inviteFailed = true;
    inviteSummary = null;
  }

  const secondaryMs = nowMs() - tSecondary0;
  const totalMs = nowMs() - t0;

  if (bootstrapTimingEnabled()) {
    console.info(
      JSON.stringify({
        scope: "auth_bootstrap",
        profileMs: Math.round(profileMs),
        secondaryMs: Math.round(secondaryMs),
        totalMs: Math.round(totalMs),
        registered: true,
        greenwood: isGreenwoodMember,
        firstThirtyFailed,
        inviteFailed,
      }),
    );
  }

  // Ensure profile id is not needed; profileDto already omits invite_code/privy.
  void (profileRow as ProfileRecord);

  const bootstrap: AuthenticatedWorldBootstrap = {
    authenticated: true,
    registered: true,
    profile: safeProfile,
    application,
    wallets,
    firstThirty,
    inviteSummary,
    errors: {
      firstThirty: firstThirtyFailed,
      inviteSummary: inviteFailed,
    },
  };

  return {
    bootstrap,
    timing: {
      profileMs,
      secondaryMs,
      totalMs,
    },
  };
}
