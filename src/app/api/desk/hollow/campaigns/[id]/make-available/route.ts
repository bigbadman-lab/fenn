import { requireFennDeskAccess } from "@/lib/desk/auth";
import {
  deskMakeCampaignAvailable,
  getDeskCampaign,
} from "@/lib/desk/hollow";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { id } = await context.params;
    await deskMakeCampaignAvailable(id, identity.actorId);
    const campaign = await getDeskCampaign(id);
    return deskJson({ ok: true, campaign });
  } catch (error) {
    return mapDeskError(
      error,
      "POST /api/desk/hollow/campaigns/[id]/make-available",
    );
  }
}
