import { requireFennDeskAccess } from "@/lib/desk/auth";
import { getDeskDeedSubmission } from "@/lib/desk/deeds";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireFennDeskAccess(request);
    const { id } = await context.params;
    const submission = await getDeskDeedSubmission(id);
    if (!submission) {
      return deskJson({ ok: false, error: "not_found" }, { status: 404 });
    }
    return deskJson({ ok: true, submission });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/deeds/submissions/[id]");
  }
}
