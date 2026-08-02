import { z } from "zod";

import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskApproveDeedSubmission } from "@/lib/desk/deeds";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    leafAmount: z.number().int().optional().nullable(),
    reviewNote: z.string().max(2000).optional().nullable(),
  })
  .strict();

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { id } = await context.params;
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return deskJson({ ok: false, error: "invalid_json" }, { status: 422 });
    }
    const result = await deskApproveDeedSubmission({
      submissionId: id,
      identity,
      leafAmount: parsed.data.leafAmount,
      reviewNote: parsed.data.reviewNote,
    });
    return deskJson({ ok: true, result });
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/deeds/submissions/[id]/approve");
  }
}
