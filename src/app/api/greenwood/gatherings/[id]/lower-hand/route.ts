import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { lowerGatheringHand } from "@/lib/greenwood/gatherings/member-ops";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/greenwood/gatherings/[id]/lower-hand
 * Empty body. Profile from Privy only.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const badBody = await rejectIdentityBody(request);
    if (badBody) return badBody;

    const { id } = await context.params;
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

    const gathering = await lowerGatheringHand(id, profile.id, admin);
    return NextResponse.json(
      { ok: true, gathering },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapError(error, "POST lower-hand");
  }
}

async function rejectIdentityBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (
    body != null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body as object).length > 0
  ) {
    return NextResponse.json(
      {
        error: "Request body must be empty",
        code: "greenwood_gathering_failed",
      },
      { status: 400 },
    );
  }
  return null;
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
