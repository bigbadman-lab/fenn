import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskCancelGathering } from "@/lib/desk/gatherings";
import { deskJson } from "@/lib/desk/http";
import { mapDeskGatheringError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { id } = await context.params;
    let reason: string | null = null;
    try {
      const body = (await request.json()) as { reason?: string };
      reason = body.reason ?? null;
    } catch {
      reason = null;
    }
    const gathering = await deskCancelGathering(
      id,
      identity.actorId,
      reason,
    );
    return deskJson({ ok: true, gathering });
  } catch (error) {
    return mapDeskGatheringError(error, "POST cancel desk gathering");
  }
}
