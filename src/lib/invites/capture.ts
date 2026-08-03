import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeInviteAuditLog } from "@/lib/invites/audit";
import { normalizeInviteCode } from "@/lib/invites/codes";
import type { OutlawInviteCaptureResult } from "@/lib/invites/types";
import { formatOutlawNumber } from "@/lib/profiles/types";
import { createAdminClient } from "@/lib/supabase/admin";

type LookupRow = {
  valid: boolean;
  inviter_outlaw_number: number | string | null;
};

/**
 * Validate invite code server-side. Returns no internal profile IDs.
 */
export async function lookupInviteCode(
  rawCode: string,
  admin?: SupabaseClient,
): Promise<OutlawInviteCaptureResult> {
  const code = normalizeInviteCode(rawCode);
  if (!code) {
    return { valid: false, inviterLabel: null };
  }

  const db = admin ?? createAdminClient();
  const { data, error } = await db.rpc("lookup_outlaw_invite_code", {
    p_invite_code: code,
  });

  if (error) {
    console.error("[lookup_outlaw_invite_code]", error);
    return { valid: false, inviterLabel: null };
  }

  const row = (Array.isArray(data) ? data[0] : data) as LookupRow | undefined;
  if (!row || !row.valid) {
    return { valid: false, inviterLabel: null };
  }

  const num = Number(row.inviter_outlaw_number);
  if (!Number.isFinite(num) || num < 1) {
    return { valid: true, inviterLabel: null };
  }

  return {
    valid: true,
    inviterLabel: `OUTLAW ${formatOutlawNumber(num)}`,
  };
}

/**
 * Capture attribution after validating. Audit only on success.
 * Caller sets the cookie.
 */
export async function captureInviteAttribution(
  rawCode: string,
  admin?: SupabaseClient,
): Promise<OutlawInviteCaptureResult> {
  const result = await lookupInviteCode(rawCode, admin);

  if (result.valid) {
    try {
      const db = admin ?? createAdminClient();
      await writeInviteAuditLog(db, {
        action: "outlaw_invite.captured",
        entityType: "invite_code",
        entityId: "captured",
        afterState: {
          inviterLabel: result.inviterLabel,
        },
      });
    } catch (err) {
      // Non-fatal: capture still succeeds
      console.error("[outlaw_invite.captured audit]", err);
    }
  }

  return result;
}
