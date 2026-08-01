import { NextResponse } from "next/server";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { adminCancelCampaign } from "@/lib/greenwood/hollow/campaign-ops";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennAdmin(request);
    const { id } = await context.params;
    let reason: string | null = null;
    try {
      const body = (await request.json()) as { reason?: string };
      reason = body.reason ?? null;
    } catch {
      reason = null;
    }
    const admin = createAdminClient();
    const campaign = await adminCancelCampaign(
      id,
      identity.actorId,
      reason,
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
    console.error("[POST cancel campaign]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "greenwood_hollow_failed" },
      { status: 500 },
    );
  }
}
