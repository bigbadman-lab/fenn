import { z } from "zod";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { prepareTodaysEditorialPackage } from "@/lib/editorial";
import { createAdminClient } from "@/lib/supabase/admin";

/** Editorial package generation is model-bound; allow a full newsroom pass. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  confirm: z.literal(true),
  coveredDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  whatMattersToday: z.string().max(2000).optional().nullable(),
});

/**
 * Prepare a full day’s editorial package (one model call → 24 drafts).
 * No automatic posting.
 */
export async function POST(request: Request) {
  try {
    const identity = await requireFennDeskAccess(request);
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return deskJson(
        { ok: false, error: "confirm true is required" },
        { status: 400 },
      );
    }

    const run = await prepareTodaysEditorialPackage({
      createdBy: identity.actorId,
      coveredDate: parsed.data.coveredDate,
      whatMattersToday: parsed.data.whatMattersToday ?? null,
    });

    const db = createAdminClient();
    await writeAdminAuditLog(db, {
      actorId: identity.actorId,
      action: "desk.editorial.generate",
      entityType: "editorial_run",
      entityId: run.id,
      afterState: {
        coveredDate: run.coveredDate,
        transmissionCount: run.transmissions.length,
      },
    });

    return deskJson({ ok: true, run });
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/editorial/generate");
  }
}
