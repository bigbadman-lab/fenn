import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeInviteAuditLog } from "@/lib/invites/audit";
import { normalizeInviteCode } from "@/lib/invites/codes";
import type { OutlawInviteRegisterOutcome } from "@/lib/invites/types";
import { createAdminClient } from "@/lib/supabase/admin";

type RegisterInviteRpcRow = {
  outcome: string;
  invite_id: string | null;
  inviter_profile_id: string | null;
  rewarded: boolean;
  reward_amount: number;
  rewarded_invite_number: number | null;
  leaf_ledger_id: string | null;
  status: string;
};

export type RegisterInviteResult = {
  outcome: OutlawInviteRegisterOutcome;
  inviteId: string | null;
  rewarded: boolean;
  rewardAmount: number;
  status: string | null;
};

function mapOutcome(raw: string | null | undefined): OutlawInviteRegisterOutcome {
  switch (raw) {
    case "rewarded":
    case "cap_reached":
    case "already_attributed":
    case "already_rewarded":
    case "invalid_code":
    case "rejected_self":
      return raw;
    default:
      return "failed";
  }
}

/**
 * Consume invite attribution after a genuine new registration.
 * Idempotent. Must not throw for expected product outcomes.
 */
export async function registerOutlawInvite(input: {
  invitedProfileId: string;
  inviteCode: string;
  admin?: SupabaseClient;
}): Promise<RegisterInviteResult> {
  const code = normalizeInviteCode(input.inviteCode);
  if (!code) {
    return {
      outcome: "invalid_code",
      inviteId: null,
      rewarded: false,
      rewardAmount: 0,
      status: "rejected",
    };
  }

  const admin = input.admin ?? createAdminClient();
  const { data, error } = await admin.rpc("register_outlaw_invite", {
    p_invite_code: code,
    p_invited_profile_id: input.invitedProfileId,
  });

  if (error) {
    console.error("[register_outlaw_invite]", error);
    throw new Error(error.message ?? "register_outlaw_invite_failed");
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | RegisterInviteRpcRow
    | undefined;

  if (!row) {
    throw new Error("register_outlaw_invite_empty");
  }

  return {
    outcome: mapOutcome(row.outcome),
    inviteId: row.invite_id,
    rewarded: Boolean(row.rewarded),
    rewardAmount: Number(row.reward_amount) || 0,
    status: row.status ?? null,
  };
}

/** Persist retry only after registration when invite processing failed hard. */
export async function saveInviteRetry(input: {
  invitedProfileId: string;
  inviteCode: string;
  lastError?: string | null;
  admin?: SupabaseClient;
}): Promise<void> {
  const code = normalizeInviteCode(input.inviteCode);
  if (!code) return;

  const admin = input.admin ?? createAdminClient();
  const { error } = await admin.from("outlaw_invite_retries").upsert(
    {
      invited_profile_id: input.invitedProfileId,
      invite_code: code,
      last_error: input.lastError ?? null,
    },
    { onConflict: "invited_profile_id" },
  );

  if (error) {
    console.error("[outlaw_invite_retries upsert]", error);
  }
}

export async function clearInviteRetry(
  invitedProfileId: string,
  admin?: SupabaseClient,
): Promise<void> {
  const db = admin ?? createAdminClient();
  await db
    .from("outlaw_invite_retries")
    .delete()
    .eq("invited_profile_id", invitedProfileId);
}

/**
 * Best-effort invite consumption after successful new registration.
 * Never throws — registration success is authoritative.
 */
export async function tryConsumeInviteAfterRegistration(input: {
  invitedProfileId: string;
  inviteCode: string | null;
  admin?: SupabaseClient;
}): Promise<RegisterInviteResult> {
  if (!input.inviteCode) {
    return {
      outcome: "skipped",
      inviteId: null,
      rewarded: false,
      rewardAmount: 0,
      status: null,
    };
  }

  const admin = input.admin ?? createAdminClient();

  try {
    const result = await registerOutlawInvite({
      invitedProfileId: input.invitedProfileId,
      inviteCode: input.inviteCode,
      admin,
    });

    // Terminal outcomes: drop retry + cookie handled by caller
    if (
      result.outcome === "rewarded" ||
      result.outcome === "cap_reached" ||
      result.outcome === "already_attributed" ||
      result.outcome === "already_rewarded" ||
      result.outcome === "invalid_code" ||
      result.outcome === "rejected_self"
    ) {
      await clearInviteRetry(input.invitedProfileId, admin);
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "invite_failed";
    console.error("[tryConsumeInviteAfterRegistration]", err);
    await saveInviteRetry({
      invitedProfileId: input.invitedProfileId,
      inviteCode: input.inviteCode,
      lastError: message,
      admin,
    });
    try {
      await writeInviteAuditLog(admin, {
        action: "outlaw_invite.processing_failed",
        entityType: "profile",
        entityId: input.invitedProfileId,
        afterState: { error: message },
      });
    } catch {
      // ignore audit failure
    }
    return {
      outcome: "failed",
      inviteId: null,
      rewarded: false,
      rewardAmount: 0,
      status: null,
    };
  }
}

/**
 * Retry invite attribution from durable retry row only (never bare cookie).
 * Safe on profile bootstrap — does not attribute existing members who merely opened a link.
 */
export async function processInviteRetryForProfile(
  profileId: string,
  admin?: SupabaseClient,
): Promise<RegisterInviteResult | null> {
  const db = admin ?? createAdminClient();
  const { data, error } = await db
    .from("outlaw_invite_retries")
    .select("invite_code")
    .eq("invited_profile_id", profileId)
    .maybeSingle();

  if (error || !data) return null;

  const code = normalizeInviteCode(
    (data as { invite_code: string }).invite_code,
  );
  if (!code) {
    await clearInviteRetry(profileId, db);
    return null;
  }

  return tryConsumeInviteAfterRegistration({
    invitedProfileId: profileId,
    inviteCode: code,
    admin: db,
  });
}
