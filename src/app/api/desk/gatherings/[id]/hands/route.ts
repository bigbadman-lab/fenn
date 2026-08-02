import { requireFennDeskAccess } from "@/lib/desk/auth";
import { getDeskGatheringDetail } from "@/lib/desk/gatherings";
import { deskJson } from "@/lib/desk/http";
import { mapDeskGatheringError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Hands + attendance for a Gathering — Desk-only. */
export async function GET(request: Request, context: RouteContext) {
  try {
    await requireFennDeskAccess(request);
    const { id } = await context.params;
    const gathering = await getDeskGatheringDetail(id);
    return deskJson({
      ok: true,
      gatheringId: gathering.id,
      openHandCount: gathering.openHandCount,
      loweredHandCount: gathering.loweredHandCount,
      attendanceCount: gathering.attendanceCount,
      hands: gathering.hands,
    });
  } catch (error) {
    return mapDeskGatheringError(error, "GET desk gathering hands");
  }
}
