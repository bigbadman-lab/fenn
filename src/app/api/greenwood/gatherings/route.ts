import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { getFireGatheringsSnapshot } from "@/lib/greenwood/gatherings/member-ops";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/greenwood/gatherings
 * Member-safe active + upcoming Fire Gatherings.
 */
export async function GET(request: Request) {
  try {
    const identity = await getVerifiedPrivyUser(request);
    const admin = createAdminClient();
    const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);
    if (!profile) {
      return NextResponse.json(
        {
          error: "Outlaw registration required",
          code: "outlaw_registration_required",
        },
        { status: 403 },
      );
    }
    if (profile.greenwood_entered_at == null) {
      return NextResponse.json(
        {
          error: "Greenwood membership required",
          code: "greenwood_membership_required",
        },
        { status: 403 },
      );
    }

    const gatherings = await getFireGatheringsSnapshot(profile.id, admin);
    return NextResponse.json(
      { ok: true, gatherings },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapError(error, "GET /api/greenwood/gatherings");
  }
}

function mapError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: "Not authenticated", code: "unauthorized" },
      { status: 401 },
    );
  }
  if (error instanceof GreenwoodError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error(`[${label}]`, error);
  return NextResponse.json(
    { error: "Internal server error", code: "greenwood_gathering_failed" },
    { status: 500 },
  );
}
