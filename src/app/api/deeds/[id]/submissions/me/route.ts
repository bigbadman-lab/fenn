import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import {
  DeedSubmissionError,
  getMySubmissionsForDeed,
} from "@/lib/deeds/submissions";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Own submissions for a Deed only.
 * profileId is resolved server-side from Privy — never from the client.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { id: deedId } = await context.params;
    const identity = await getVerifiedPrivyUser(request);
    const admin = createAdminClient();
    const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);

    if (!profile) {
      return NextResponse.json(
        {
          error: "A name must be entered in the book first",
          code: "not_registered",
        },
        { status: 403 },
      );
    }

    const submissions = await getMySubmissionsForDeed(profile.id, deedId, admin);

    return NextResponse.json({ ok: true, submissions });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: "Not authenticated", code: "unauthorized" },
        { status: 401 },
      );
    }

    if (error instanceof DeedSubmissionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("[api/deeds/submissions/me]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "internal_error" },
      { status: 500 },
    );
  }
}
