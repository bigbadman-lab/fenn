import { NextResponse } from "next/server";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import { GreenwoodError } from "@/lib/greenwood/errors";
import {
  adminGetGathering,
  adminUpdateGatheringDraft,
} from "@/lib/greenwood/gatherings/admin-ops";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireFennAdmin(request);
    const { id } = await context.params;
    const admin = createAdminClient();
    const gathering = await adminGetGathering(id, admin);
    return NextResponse.json(
      { ok: true, gathering },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapAdminError(error, "GET admin gathering");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennAdmin(request);
    const { id } = await context.params;
    const body = (await request.json()) as {
      title?: string;
      summary?: string;
      startsAt?: string;
      endsAt?: string;
      capacity?: number | null;
      rewardLeafPreview?: number | null;
      linkedDeedId?: string | null;
    };
    const admin = createAdminClient();
    const gathering = await adminUpdateGatheringDraft(
      id,
      body,
      identity.actorId,
      admin,
    );
    return NextResponse.json(
      { ok: true, gathering },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapAdminError(error, "PATCH admin gathering");
  }
}

function mapAdminError(error: unknown, label: string) {
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
  console.error(`[${label}]`, error);
  return NextResponse.json(
    { error: "Internal server error", code: "greenwood_gathering_failed" },
    { status: 500 },
  );
}
