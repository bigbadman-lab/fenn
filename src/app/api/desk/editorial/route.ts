import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { getEditorialRoomSnapshot } from "@/lib/editorial";

/**
 * Desk Editorial Room snapshot — overview + latest run for today.
 */
export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const room = await getEditorialRoomSnapshot();
    return deskJson({ ok: true, room });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/editorial");
  }
}
