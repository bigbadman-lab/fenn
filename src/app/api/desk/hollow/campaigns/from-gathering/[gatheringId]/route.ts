import { requireFennDeskAccess } from "@/lib/desk/auth";
import {
  deskCreateCampaignFromGathering,
  getDeskCampaign,
} from "@/lib/desk/hollow";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import type { HollowRewardType } from "@/lib/greenwood/hollow/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ gatheringId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { gatheringId } = await context.params;
    const body = (await request.json()) as {
      title?: string;
      reason?: string;
      rewardType?: HollowRewardType;
      amountPerRecipient?: number | null;
      assetChainId?: number | null;
      assetContractAddress?: string | null;
      assetSymbol?: string | null;
    };

    if (!body.title || !body.rewardType) {
      return deskJson(
        { ok: false, error: "title and rewardType are required" },
        { status: 400 },
      );
    }

    const created = await deskCreateCampaignFromGathering(
      gatheringId,
      {
        title: body.title,
        reason: body.reason,
        rewardType: body.rewardType,
        amountPerRecipient: body.amountPerRecipient,
        assetChainId: body.assetChainId,
        assetContractAddress: body.assetContractAddress,
        assetSymbol: body.assetSymbol,
      },
      identity.actorId,
    );

    const campaign = await getDeskCampaign(created.id);
    return deskJson({ ok: true, campaign }, { status: 201 });
  } catch (error) {
    return mapDeskError(
      error,
      "POST /api/desk/hollow/campaigns/from-gathering/[gatheringId]",
    );
  }
}
