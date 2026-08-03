import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { getOutlawInviteMemberSummary } from "@/lib/invites";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Authenticated invite summary for the current Outlaw.
 * Read-only; no internal invitee IDs.
 */
export async function GET(request: Request) {
  try {
    const identity = await getVerifiedPrivyUser(request);
    const admin = createAdminClient();
    const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);

    if (!profile) {
      return NextResponse.json(
        { error: "Registration required", code: "not_registered" },
        {
          status: 403,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }

    const invite = await getOutlawInviteMemberSummary({
      profileId: profile.id,
      admin,
    });

    if (!invite) {
      return NextResponse.json(
        { error: "Invite data unavailable", code: "invite_unavailable" },
        {
          status: 503,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }

    return NextResponse.json(
      { ok: true, invite },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message, code: "unauthorized" },
        {
          status: error.status,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }

    console.error("[api/invites/me]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "internal_error" },
      {
        status: 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
