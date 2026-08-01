import { NextResponse } from "next/server";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import { GreenwoodError } from "@/lib/greenwood/errors";
import {
  adminCreateCampaignDraft,
  adminListCampaigns,
} from "@/lib/greenwood/hollow/campaign-ops";
import type {
  CampaignRecipientRule,
  HollowRewardType,
} from "@/lib/greenwood/hollow/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireFennAdmin(request);
    const admin = createAdminClient();
    const campaigns = await adminListCampaigns(admin);
    return NextResponse.json(
      { ok: true, campaigns },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapAdminError(error, "GET admin rewards");
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireFennAdmin(request);
    const body = (await request.json()) as {
      title?: string;
      reason?: string;
      rewardType?: HollowRewardType;
      amountPerRecipient?: number | null;
      assetChainId?: number | null;
      assetContractAddress?: string | null;
      assetSymbol?: string | null;
      recipientRule?: CampaignRecipientRule;
      gatheringId?: string | null;
      profileIds?: string[];
    };
    if (!body.title || !body.rewardType || !body.recipientRule) {
      return NextResponse.json(
        { error: "title, rewardType, and recipientRule are required" },
        { status: 400 },
      );
    }
    const admin = createAdminClient();
    const campaign = await adminCreateCampaignDraft(
      {
        title: body.title,
        reason: body.reason,
        rewardType: body.rewardType,
        amountPerRecipient: body.amountPerRecipient,
        assetChainId: body.assetChainId,
        assetContractAddress: body.assetContractAddress,
        assetSymbol: body.assetSymbol,
        recipientRule: body.recipientRule,
        gatheringId: body.gatheringId,
        profileIds: body.profileIds,
      },
      identity.actorId,
      admin,
    );
    return NextResponse.json(
      { ok: true, campaign },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapAdminError(error, "POST admin rewards");
  }
}

function mapAdminError(error: unknown, label: string) {
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
  console.error(`[${label}]`, error);
  return NextResponse.json(
    { error: "Internal server error", code: "greenwood_hollow_failed" },
    { status: 500 },
  );
}
