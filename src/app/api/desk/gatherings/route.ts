import { requireFennDeskAccess } from "@/lib/desk/auth";
import {
  deskCreateGatheringDraft,
  listDeskGatherings,
} from "@/lib/desk/gatherings";
import type { DeskGatheringFilter } from "@/lib/desk/gatherings-types";
import { deskJson } from "@/lib/desk/http";
import { mapDeskGatheringError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

const FILTERS = new Set<DeskGatheringFilter>([
  "all",
  "draft",
  "upcoming",
  "active",
  "closed",
  "cancelled",
  "closed_hands_no_campaign",
]);

export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const url = new URL(request.url);
    const raw = (url.searchParams.get("filter") ?? "all") as DeskGatheringFilter;
    const filter = FILTERS.has(raw) ? raw : null;
    if (!filter) {
      return deskJson({ ok: false, error: "invalid_filter" }, { status: 400 });
    }
    const gatherings = await listDeskGatherings(filter);
    return deskJson({ ok: true, gatherings });
  } catch (error) {
    return mapDeskGatheringError(error, "GET /api/desk/gatherings");
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireFennDeskAccess(request);
    const body = (await request.json()) as {
      title?: string;
      summary?: string;
      startsAt?: string;
      endsAt?: string;
      capacity?: number | null;
      rewardLeafPreview?: number | null;
      linkedDeedId?: string | null;
    };

    if (!body.title || !body.startsAt || !body.endsAt) {
      return deskJson(
        { ok: false, error: "title, startsAt and endsAt are required" },
        { status: 400 },
      );
    }

    const gathering = await deskCreateGatheringDraft(
      {
        title: body.title,
        summary: body.summary,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        capacity: body.capacity,
        rewardLeafPreview: body.rewardLeafPreview,
        linkedDeedId: body.linkedDeedId,
      },
      identity.actorId,
    );

    return deskJson({ ok: true, gathering }, { status: 201 });
  } catch (error) {
    return mapDeskGatheringError(error, "POST /api/desk/gatherings");
  }
}
