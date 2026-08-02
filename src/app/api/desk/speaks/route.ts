import { z } from "zod";

import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import {
  createFireMessageDraft,
  listOperatorFireMessages,
} from "@/lib/greenwood/fire-messages";
import { GREENWOOD_FIRE_MESSAGE_MAX_CHARS } from "@/lib/greenwood/fire-message";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  body: z.string().max(GREENWOOD_FIRE_MESSAGE_MAX_CHARS),
});

/** GET /api/desk/speaks — current + recent FENN SPEAKS for Desk. */
export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const admin = createAdminClient();
    const speaks = await listOperatorFireMessages(20, admin);
    return deskJson({ ok: true, speaks });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/speaks");
  }
}

/** POST /api/desk/speaks — create draft. */
export async function POST(request: Request) {
  try {
    const identity = await requireFennDeskAccess(request);
    const json = await request.json();
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return deskJson(
        { ok: false, error: "Invalid message body", code: "invalid_body" },
        { status: 400 },
      );
    }
    const admin = createAdminClient();
    const message = await createFireMessageDraft(
      parsed.data.body,
      identity.profileId,
      identity.actorId,
      admin,
    );
    return deskJson({ ok: true, message }, { status: 201 });
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/speaks");
  }
}
