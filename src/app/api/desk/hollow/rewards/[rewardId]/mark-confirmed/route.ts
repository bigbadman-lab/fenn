import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskMarkConfirmed, getDeskCampaign } from "@/lib/desk/hollow";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ rewardId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { rewardId } = await context.params;
    const adminDetail = await deskMarkConfirmed(rewardId, identity.actorId);
    const campaign = await getDeskCampaign(adminDetail.id);
    return deskJson({ ok: true, campaign });
  } catch (error) {
    return mapDeskError(
      error,
      "POST /api/desk/hollow/rewards/[rewardId]/mark-confirmed",
    );
  }
}
