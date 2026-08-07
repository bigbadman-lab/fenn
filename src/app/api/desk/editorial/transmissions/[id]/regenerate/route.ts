import { z } from "zod";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { regenerateEditorialTransmission } from "@/lib/editorial";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  confirm: z.literal(true),
});

type RouteContext = { params: Promise<{ id: string }> };

/** Regenerate one transmission. No package-wide rewrite. No posting. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { id } = await context.params;
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return deskJson(
        { ok: false, error: "confirm true is required" },
        { status: 400 },
      );
    }

    const transmission = await regenerateEditorialTransmission({
      transmissionId: id,
    });

    const db = createAdminClient();
    await writeAdminAuditLog(db, {
      actorId: identity.actorId,
      action: "desk.editorial.regenerate",
      entityType: "editorial_transmission",
      entityId: transmission.id,
      afterState: { category: transmission.category },
    });

    return deskJson({ ok: true, transmission });
  } catch (error) {
    return mapDeskError(
      error,
      "POST /api/desk/editorial/transmissions/[id]/regenerate",
    );
  }
}
