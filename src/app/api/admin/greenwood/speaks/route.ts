import { NextResponse } from "next/server";
import { z } from "zod";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import {
  createFireMessageDraft,
  listOperatorFireMessages,
} from "@/lib/greenwood/fire-messages";
import { GREENWOOD_FIRE_MESSAGE_MAX_CHARS } from "@/lib/greenwood/fire-message";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

const createSchema = z.object({
  body: z.string().max(GREENWOOD_FIRE_MESSAGE_MAX_CHARS),
});

function mapError(error: unknown, label: string) {
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
  console.error(`[${label}]`, error);
  return NextResponse.json(
    { ok: false, error: "VELL SPEAKS request failed" },
    { status: 500, headers: NO_STORE },
  );
}

/** GET /api/admin/greenwood/speaks */
export async function GET(request: Request) {
  try {
    await requireFennAdmin(request);
    const admin = createAdminClient();
    const speaks = await listOperatorFireMessages(20, admin);
    return NextResponse.json({ ok: true, speaks }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error, "GET /api/admin/greenwood/speaks");
  }
}

/** POST /api/admin/greenwood/speaks — create draft. */
export async function POST(request: Request) {
  try {
    const identity = await requireFennAdmin(request);
    const json = await request.json();
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid message body", code: "invalid_body" },
        { status: 400, headers: NO_STORE },
      );
    }
    const admin = createAdminClient();
    const message = await createFireMessageDraft(
      parsed.data.body,
      identity.profileId,
      identity.actorId,
      admin,
    );
    return NextResponse.json(
      { ok: true, message },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    return mapError(error, "POST /api/admin/greenwood/speaks");
  }
}
