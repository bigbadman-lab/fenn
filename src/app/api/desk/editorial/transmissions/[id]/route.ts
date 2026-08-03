import { z } from "zod";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { updateTransmissionEditedBody } from "@/lib/editorial";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  editedBody: z.string().min(1).max(4000),
});

type RouteContext = { params: Promise<{ id: string }> };

/** Operator edit of a single transmission body. Original body is preserved. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { id } = await context.params;
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return deskJson(
        { ok: false, error: "editedBody is required" },
        { status: 400 },
      );
    }

    const transmission = await updateTransmissionEditedBody({
      transmissionId: id,
      editedBody: parsed.data.editedBody,
    });

    const db = createAdminClient();
    await writeAdminAuditLog(db, {
      actorId: identity.actorId,
      action: "desk.editorial.edit",
      entityType: "editorial_transmission",
      entityId: transmission.id,
    });

    return deskJson({ ok: true, transmission });
  } catch (error) {
    return mapDeskError(error, "PATCH /api/desk/editorial/transmissions/[id]");
  }
}
