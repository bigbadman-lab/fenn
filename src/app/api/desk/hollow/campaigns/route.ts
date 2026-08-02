import {
  deskCreateCampaignDraft,
  listDeskCampaigns,
} from "@/lib/desk/hollow";
import type { DeskHollowFilter } from "@/lib/desk/hollow-types";
import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import type {
  CampaignRecipientRule,
  HollowRewardType,
} from "@/lib/greenwood/hollow/types";

export const dynamic = "force-dynamic";

const FILTERS = new Set<DeskHollowFilter>([
  "all",
  "draft",
  "resolved",
  "available",
  "completed",
  "completed_partial",
  "cancelled",
  "leaf",
  "on_chain",
  "requires_attention",
]);

export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const url = new URL(request.url);
    const raw = (url.searchParams.get("filter") ?? "all") as DeskHollowFilter;
    const filter = FILTERS.has(raw) ? raw : null;
    if (!filter) {
      return deskJson({ ok: false, error: "invalid_filter" }, { status: 400 });
    }
    const campaigns = await listDeskCampaigns(filter);
    return deskJson({ ok: true, campaigns });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/hollow/campaigns");
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireFennDeskAccess(request);
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
      return deskJson(
        {
          ok: false,
          error: "title, rewardType, and recipientRule are required",
        },
        { status: 400 },
      );
    }

    if (
      body.recipientRule !== "manual_profiles" &&
      body.recipientRule !== "gathering_open_hands"
    ) {
      return deskJson(
        { ok: false, error: "unsupported recipientRule" },
        { status: 400 },
      );
    }

    const campaign = await deskCreateCampaignDraft(
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
    );

    return deskJson({ ok: true, campaign }, { status: 201 });
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/hollow/campaigns");
  }
}
