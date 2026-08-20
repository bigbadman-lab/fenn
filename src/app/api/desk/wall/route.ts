import { z } from "zod";

import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { deskInscribeWall } from "@/lib/desk/wall-inscribe";
import { createAdminClient } from "@/lib/supabase/admin";
import { listPublicWallEntries } from "@/lib/wall/read";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DESK_WALL_RECENT_LIMIT = 12;

const inscribeSchema = z
  .object({
    body: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1).max(WALL_BODY_MAX_CHARS)),
  })
  .strict();

/** GET /api/desk/wall — recent public Wall inscriptions for Desk preview. */
export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const admin = createAdminClient();
    const entries = await listPublicWallEntries({
      limit: DESK_WALL_RECENT_LIMIT,
      admin,
    });
    return deskJson({ ok: true, entries });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/wall");
  }
}

/**
 * POST /api/desk/wall — keeper inscribes The Wall as VELL.
 * Does not open a public create path.
 */
export async function POST(request: Request) {
  try {
    const identity = await requireFennDeskAccess(request);
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return deskJson(
        { ok: false, error: "invalid_json", code: "invalid_json" },
        { status: 422 },
      );
    }
    const parsed = inscribeSchema.safeParse(json);
    if (!parsed.success) {
      return deskJson(
        { ok: false, error: "invalid_body", code: "invalid_body" },
        { status: 422 },
      );
    }

    const result = await deskInscribeWall({
      body: parsed.data.body,
      actorId: identity.actorId,
    });

    return deskJson(
      {
        ok: true,
        created: result.created,
        entry: result.entry,
        wallPath: result.wallPath,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/wall");
  }
}
