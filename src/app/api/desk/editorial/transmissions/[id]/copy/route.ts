import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { incrementTransmissionCopyCount } from "@/lib/editorial";

type RouteContext = { params: Promise<{ id: string }> };

/** Record a successful client copy. Never receives body contents for logging. */
export async function POST(request: Request, context: RouteContext) {
  try {
    await requireFennDeskAccess(request);
    const { id } = await context.params;
    const transmission = await incrementTransmissionCopyCount({
      transmissionId: id,
    });
    return deskJson({ ok: true, copyCount: transmission.copyCount });
  } catch (error) {
    return mapDeskError(
      error,
      "POST /api/desk/editorial/transmissions/[id]/copy",
    );
  }
}
