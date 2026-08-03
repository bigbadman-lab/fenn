import { z } from "zod";

import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { shareApprovedSubmissionToWall } from "@/lib/deeds/submission-wall";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    body: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1).max(WALL_BODY_MAX_CHARS)),
  })
  .strict();

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { id: submissionId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return deskJson(
        { ok: false, error: "invalid_json", code: "invalid_json" },
        { status: 422 },
      );
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return deskJson(
        { ok: false, error: "invalid_body", code: "invalid_body" },
        { status: 422 },
      );
    }
    const result = await shareApprovedSubmissionToWall({
      submissionId,
      body: parsed.data.body,
      actorId: identity.actorId,
    });
    return deskJson({
      ok: true,
      created: result.created,
      wallShare: result.wallShare,
      entry: result.entry,
    });
  } catch (error) {
    return mapDeskError(
      error,
      "POST /api/desk/deeds/submissions/[id]/share-to-wall",
    );
  }
}
