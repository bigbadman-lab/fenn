import { z } from "zod";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { approveTransmission } from "@/lib/editorial";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  confirm: z.literal(true),
});

type RouteContext = { params: Promise<{ id: string }> };

/** Approve for manual posting — does not post anywhere. */
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

    const transmission = await approveTransmission({ transmissionId: id });

    const db = createAdminClient();
    await writeAdminAuditLog(db, {
      actorId: identity.actorId,
      action: "desk.editorial.approve",
      entityType: "editorial_transmission",
      entityId: transmission.id,
    });

    return deskJson({ ok: true, transmission });
  } catch (error) {
    return mapDeskError(
      error,
      "POST /api/desk/editorial/transmissions/[id]/approve",
    );
  }
}
