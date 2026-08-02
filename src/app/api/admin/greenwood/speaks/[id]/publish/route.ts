import { NextResponse } from "next/server";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import { publishFireMessage } from "@/lib/greenwood/fire-messages";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/admin/greenwood/speaks/[id]/publish */
export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennAdmin(request);
    const { id } = await context.params;
    const admin = createAdminClient();
    const result = await publishFireMessage(
      id,
      identity.profileId,
      identity.actorId,
      admin,
    );
    return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: error.status, headers: NO_STORE },
      );
    }
    if (error instanceof GreenwoodError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status, headers: NO_STORE },
      );
    }
    console.error("[POST /api/admin/greenwood/speaks/[id]/publish]", error);
    return NextResponse.json(
      { ok: false, error: "Publish failed" },
      { status: 500, headers: NO_STORE },
    );
  }
}
