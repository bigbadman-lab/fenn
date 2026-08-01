import { NextResponse } from "next/server";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import { GreenwoodError } from "@/lib/greenwood/errors";
import {
  adminCreateGatheringDraft,
  adminListGatherings,
} from "@/lib/greenwood/gatherings/admin-ops";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireFennAdmin(request);
    const admin = createAdminClient();
    const gatherings = await adminListGatherings(admin);
    return NextResponse.json(
      { ok: true, gatherings },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapAdminError(error, "GET /api/admin/greenwood/gatherings");
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireFennAdmin(request);
    const body = (await request.json()) as {
      title?: string;
      summary?: string;
      startsAt?: string;
      endsAt?: string;
      capacity?: number | null;
      rewardLeafPreview?: number | null;
      linkedDeedId?: string | null;
    };

    if (!body.title || !body.startsAt || !body.endsAt) {
      return NextResponse.json(
        {
          error: "title, startsAt and endsAt are required",
          code: "greenwood_gathering_failed",
        },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const gathering = await adminCreateGatheringDraft(
      {
        title: body.title,
        summary: body.summary,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        capacity: body.capacity,
        rewardLeafPreview: body.rewardLeafPreview,
        linkedDeedId: body.linkedDeedId,
      },
      identity.actorId,
      admin,
    );

    return NextResponse.json(
      { ok: true, gathering },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapAdminError(error, "POST /api/admin/greenwood/gatherings");
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
