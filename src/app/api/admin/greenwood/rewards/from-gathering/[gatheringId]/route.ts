import { NextResponse } from "next/server";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { adminCreateCampaignFromGathering } from "@/lib/greenwood/hollow/campaign-ops";
import type { HollowRewardType } from "@/lib/greenwood/hollow/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ gatheringId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennAdmin(request);
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
    if (!body.rewardType) {
      return NextResponse.json(
        { error: "rewardType is required" },
        { status: 400 },
      );
    }
    const admin = createAdminClient();
    const campaign = await adminCreateCampaignFromGathering(
      gatheringId,
      {
        title: body.title ?? "",
        reason: body.reason,
        rewardType: body.rewardType,
        amountPerRecipient: body.amountPerRecipient,
        assetChainId: body.assetChainId,
        assetContractAddress: body.assetContractAddress,
        assetSymbol: body.assetSymbol,
      },
      identity.actorId,
      admin,
    );
    return NextResponse.json(
      { ok: true, campaign },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json(
        { error: error.message, code: "unauthorized" },
        { status: error.status },
      );
    }
    if (error instanceof GreenwoodError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[POST from-gathering]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "greenwood_hollow_failed" },
      { status: 500 },
    );
  }
}
