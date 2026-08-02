import { requireFennDeskAccess } from "@/lib/desk/auth";
import {
  deskUpdateGatheringDraft,
  getDeskGatheringDetail,
} from "@/lib/desk/gatherings";
import { deskJson } from "@/lib/desk/http";
import { mapDeskGatheringError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireFennDeskAccess(request);
    const { id } = await context.params;
    const gathering = await getDeskGatheringDetail(id);
    return deskJson({ ok: true, gathering });
  } catch (error) {
    return mapDeskGatheringError(error, "GET /api/desk/gatherings/[id]");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { id } = await context.params;
    const body = (await request.json()) as {
      title?: string;
      summary?: string;
      startsAt?: string;
      endsAt?: string;
      capacity?: number | null;
      rewardLeafPreview?: number | null;
      linkedDeedId?: string | null;
    };
    const gathering = await deskUpdateGatheringDraft(
      id,
      body,
      identity.actorId,
    );
    return deskJson({ ok: true, gathering });
  } catch (error) {
    return mapDeskGatheringError(error, "PATCH /api/desk/gatherings/[id]");
  }
}
