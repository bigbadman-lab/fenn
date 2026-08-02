import { z } from "zod";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskGenerateBookEntry } from "@/lib/desk/book";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    coveredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    confirm: z.literal(true),
  })
  .strict();

/**
 * Fill-if-missing Book generation. Never overwrites an existing daily entry.
 */
export async function POST(request: Request) {
  try {
    const identity = await requireFennDeskAccess(request);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return deskJson(
        { ok: false, error: "coveredDate and confirm:true are required" },
        { status: 422 },
      );
    }

    const result = await deskGenerateBookEntry({
      coveredDate: parsed.data.coveredDate,
    });

    const db = createAdminClient();
    await writeAdminAuditLog(db, {
      actorId: identity.actorId,
      action: "desk.book.generate",
      entityType: "chronicle_entry",
      entityId: result.entry?.id ?? parsed.data.coveredDate,
      afterState: {
        coveredDate: result.coveredDate,
        created: result.created,
        mode: result.mode,
      },
    });

    return deskJson({ ok: true, result });
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/book/generate");
  }
}
