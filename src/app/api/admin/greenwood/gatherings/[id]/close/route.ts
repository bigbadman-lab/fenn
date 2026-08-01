import { NextResponse } from "next/server";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { adminCloseGathering } from "@/lib/greenwood/gatherings/admin-ops";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennAdmin(request);
    const { id } = await context.params;
    const admin = createAdminClient();
    const gathering = await adminCloseGathering(id, identity.actorId, admin);
    return NextResponse.json(
      { ok: true, gathering },
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
    console.error("[POST close gathering]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "greenwood_gathering_failed" },
      { status: 500 },
    );
  }
}
