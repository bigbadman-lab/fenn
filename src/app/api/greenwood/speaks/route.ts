import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import {
  getFireMessageForMemberDisplay,
} from "@/lib/greenwood/fire-messages";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/greenwood/speaks
 * Current published FENN SPEAKS for Greenwood members.
 * Uses static fallback when DB read fails so the section never goes blank.
 */
export async function GET(request: Request) {
  try {
    const identity = await getVerifiedPrivyUser(request);
    const admin = createAdminClient();
    const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);
    if (!profile) {
      return NextResponse.json(
        { ok: false, error: "Profile not found", code: "unregistered" },
        { status: 403, headers: NO_STORE },
      );
    }
    if (profile.greenwood_entered_at == null) {
      return NextResponse.json(
        {
          ok: false,
          error: "Greenwood membership required",
          code: "greenwood_membership_required",
        },
        { status: 403, headers: NO_STORE },
      );
    }

    const message = await getFireMessageForMemberDisplay(admin);
    return NextResponse.json(
      {
        ok: true,
        message: {
          paragraphs: message.paragraphs,
          fromFallback: message.fromFallback,
        },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: "unauthenticated" },
        { status: error.status, headers: NO_STORE },
      );
    }
    console.error("[GET /api/greenwood/speaks]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "FENN SPEAKS could not be loaded",
        code: "greenwood_fire_message_failed",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
