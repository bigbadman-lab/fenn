import { requireFennDeskAccess } from "@/lib/desk/auth";
import {
  deskCorrectTransaction,
  getDeskCampaign,
} from "@/lib/desk/hollow";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ rewardId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { rewardId } = await context.params;
    const body = (await request.json()) as {
      transactionHash?: string;
      reason?: string;
    };
    if (!body.transactionHash?.trim()) {
      return deskJson(
        { ok: false, error: "transactionHash is required" },
        { status: 400 },
      );
    }
    if (!body.reason?.trim()) {
      return deskJson(
        { ok: false, error: "reason is required" },
        { status: 400 },
      );
    }
    const adminDetail = await deskCorrectTransaction(
      rewardId,
      {
        transactionHash: body.transactionHash,
        reason: body.reason,
      },
      identity.actorId,
    );
    const campaign = await getDeskCampaign(adminDetail.id);
    return deskJson({ ok: true, campaign });
  } catch (error) {
    return mapDeskError(
      error,
      "POST /api/desk/hollow/rewards/[rewardId]/correct-transaction",
    );
  }
}
