import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { getHollowRewardForMember } from "@/lib/greenwood/hollow/member-ops";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
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

    const reward = await getHollowRewardForMember(id, profile.id, admin);
    return NextResponse.json(
      { ok: true, reward },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
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
    console.error("[GET hollow id]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "greenwood_hollow_failed" },
      { status: 500 },
    );
  }
}
