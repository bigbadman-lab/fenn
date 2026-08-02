import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { getFireSelfStatus } from "@/lib/greenwood/presence/self-status";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/greenwood/presence/self
 * Compact Fire readiness for shell status / heartbeat ownership.
 */
export async function GET(request: Request) {
  try {
    const identity = await getVerifiedPrivyUser(request);
    const admin = createAdminClient();
    const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);
    if (!profile) {
      return NextResponse.json(
        { ok: true, status: { member: false, active: false, sitting: false } },
        { headers: NO_STORE },
      );
    }

    const status = await getFireSelfStatus(profile.id, admin);
    return NextResponse.json({ ok: true, status }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated", code: "unauthorized" },
        { status: 401, headers: NO_STORE },
      );
    }
    if (error instanceof GreenwoodError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status, headers: NO_STORE },
      );
    }
    console.error("[GET /api/greenwood/presence/self]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Fire status failed",
        code: "greenwood_presence_failed",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
