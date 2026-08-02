import { requireFennDeskAccess } from "@/lib/desk/auth";
import { previewDeskCampaign } from "@/lib/desk/hollow";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Preview recalculates on the server; does not mutate or freeze recipients. */
export async function GET(request: Request, context: RouteContext) {
  try {
    await requireFennDeskAccess(request);
    const { id } = await context.params;
    const preview = await previewDeskCampaign(id);
    return deskJson({ ok: true, preview });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/hollow/campaigns/[id]/preview");
  }
}

export async function POST(request: Request, context: RouteContext) {
  return GET(request, context);
}
