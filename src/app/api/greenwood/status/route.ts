import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { getGreenwoodStatus } from "@/lib/greenwood/status";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { LeafError } from "@/lib/leaf/errors";

export const runtime = "nodejs";

/**
 * GET /api/greenwood/status
 * Authoritative Greenwood standing for the authenticated registered Outlaw.
 * Profile identity is resolved from Privy — never from client input.
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

    const status = await getGreenwoodStatus(profile.id, admin);
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return mapGreenwoodRouteError(error, "GET /api/greenwood/status");
  }
}

function mapGreenwoodRouteError(error: unknown, label: string) {
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
  if (error instanceof LeafError) {
    return NextResponse.json(
      { error: "Greenwood standing failed", code: "greenwood_status_failed" },
      { status: 500 },
    );
  }
  console.error(`[${label}]`, error);
  return NextResponse.json(
    { error: "Internal server error", code: "greenwood_status_failed" },
    { status: 500 },
  );
}
