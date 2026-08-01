import { NextResponse } from "next/server";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { adminMarkConfirmed } from "@/lib/greenwood/hollow/campaign-ops";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ rewardId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennAdmin(request);
    const { rewardId } = await context.params;
    const admin = createAdminClient();
    const campaign = await adminMarkConfirmed(
      rewardId,
      identity.actorId,
      admin,
    );
    return NextResponse.json(
      { ok: true, campaign },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json(
        { error: error.message, code: "unauthorized" },
        { status: error.status },
      );
    }
    if (error instanceof GreenwoodError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[POST mark-confirmed]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "greenwood_hollow_failed" },
      { status: 500 },
    );
  }
}
