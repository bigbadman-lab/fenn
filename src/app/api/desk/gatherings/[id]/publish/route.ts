import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskPublishGathering } from "@/lib/desk/gatherings";
import { deskJson } from "@/lib/desk/http";
import { mapDeskGatheringError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { id } = await context.params;
    const gathering = await deskPublishGathering(id, identity.actorId);
    return deskJson({ ok: true, gathering });
  } catch (error) {
    return mapDeskGatheringError(error, "POST publish desk gathering");
  }
}
