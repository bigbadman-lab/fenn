import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { getFirstThirtyProgress } from "@/lib/first-thirty/service";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Read-only First Thirty status.
 * Does not create a progress row (unstarted is pure derivation).
 */
export async function GET(request: Request) {
  try {
    const identity = await getVerifiedPrivyUser(request);
    const admin = createAdminClient();
    const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);

    if (!profile) {
      return NextResponse.json(
        { error: "Not registered", code: "not_registered" },
        { status: 403 },
      );
    }

    const firstThirty = await getFirstThirtyProgress({
      profileId: profile.id,
      isGreenwoodMember: profile.greenwood_entered_at != null,
      admin,
    });

    return NextResponse.json({ ok: true, firstThirty });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: "Not authenticated", code: "not_authenticated" },
        { status: 401 },
      );
    }
    console.error("[api/first-thirty]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "internal_error" },
      { status: 500 },
    );
  }
}
