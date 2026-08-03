import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { getEditorialRunById } from "@/lib/editorial";

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireFennDeskAccess(request);
    const { runId } = await context.params;
    const run = await getEditorialRunById(runId);
    return deskJson({ ok: true, run });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/editorial/runs/[runId]");
  }
}
