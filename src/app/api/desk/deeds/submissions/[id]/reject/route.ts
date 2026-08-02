import { z } from "zod";

import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskRejectDeedSubmission } from "@/lib/desk/deeds";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    reviewNote: z.string().min(1).max(2000),
  })
  .strict();

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { id } = await context.params;
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return deskJson(
        { ok: false, error: "reviewNote is required" },
        { status: 422 },
      );
    }
    const result = await deskRejectDeedSubmission({
      submissionId: id,
      identity,
      reviewNote: parsed.data.reviewNote,
    });
    return deskJson({ ok: true, result });
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/deeds/submissions/[id]/reject");
  }
}
