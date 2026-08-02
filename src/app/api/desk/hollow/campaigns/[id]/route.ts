import { requireFennDeskAccess } from "@/lib/desk/auth";
import {
  deskUpdateDraftCampaign,
  getDeskCampaign,
} from "@/lib/desk/hollow";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireFennDeskAccess(request);
    const { id } = await context.params;
    const campaign = await getDeskCampaign(id);
    return deskJson({ ok: true, campaign });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/hollow/campaigns/[id]");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { id } = await context.params;
    const body = (await request.json()) as {
      title?: string;
      reason?: string;
      amountPerRecipient?: number | null;
      profileIds?: string[];
      assetChainId?: number | null;
      assetSymbol?: string | null;
      assetContractAddress?: string | null;
    };
    await deskUpdateDraftCampaign(id, body, identity.actorId);
    const campaign = await getDeskCampaign(id);
    return deskJson({ ok: true, campaign });
  } catch (error) {
    return mapDeskError(error, "PATCH /api/desk/hollow/campaigns/[id]");
  }
}
