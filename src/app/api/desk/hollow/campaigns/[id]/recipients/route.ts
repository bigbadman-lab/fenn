import { requireFennDeskAccess } from "@/lib/desk/auth";
import { getDeskCampaign } from "@/lib/desk/hollow";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireFennDeskAccess(request);
    const { id } = await context.params;
    const campaign = await getDeskCampaign(id);
    return deskJson({
      ok: true,
      recipients: campaign.recipients,
      campaignId: campaign.id,
      status: campaign.status,
      rewardType: campaign.rewardType,
      statusCounts: campaign.statusCounts,
    });
  } catch (error) {
    return mapDeskError(
      error,
      "GET /api/desk/hollow/campaigns/[id]/recipients",
    );
  }
}
