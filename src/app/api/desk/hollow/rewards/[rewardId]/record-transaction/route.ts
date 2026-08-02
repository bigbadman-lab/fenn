import { requireFennDeskAccess } from "@/lib/desk/auth";
import {
  deskRecordTransaction,
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
      chainId?: number | null;
    };
    if (!body.transactionHash?.trim()) {
      return deskJson(
        { ok: false, error: "transactionHash is required" },
        { status: 400 },
      );
    }
    const adminDetail = await deskRecordTransaction(
      rewardId,
      {
        transactionHash: body.transactionHash,
        chainId: body.chainId,
      },
      identity.actorId,
    );
    const campaign = await getDeskCampaign(adminDetail.id);
    return deskJson({ ok: true, campaign });
  } catch (error) {
    return mapDeskError(
      error,
      "POST /api/desk/hollow/rewards/[rewardId]/record-transaction",
    );
  }
}
