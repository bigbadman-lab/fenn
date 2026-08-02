import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { completeGreenwoodArrivalCeremony } from "@/lib/greenwood/arrival-ceremony";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store",
};

/**
 * POST /api/greenwood/arrival-ceremony/complete
 * Idempotent durable mark that the one-time arrival ceremony finished.
 * Membership required. Never trusts client profile IDs.
 */
export async function POST(request: Request) {
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

    const result = await completeGreenwoodArrivalCeremony(profile.id, admin);

    if (result.status === "not_member") {
      return NextResponse.json(
        {
          ok: false,
          error: "Greenwood membership required",
          code: "not_member",
        },
        { status: 403, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        result: {
          status: result.status,
          completedAt: result.completedAt,
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
    if (error instanceof GreenwoodError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status, headers: NO_STORE },
      );
    }
    console.error("[POST /api/greenwood/arrival-ceremony/complete]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to complete arrival ceremony",
        code: "greenwood_status_failed",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
