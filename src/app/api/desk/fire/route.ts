import { requireFennDeskAccess } from "@/lib/desk/auth";
import { getDeskFireSnapshot } from "@/lib/desk/fire";
import { deskJson } from "@/lib/desk/http";
import { mapDeskGatheringError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

/**
 * Desk Fire presence snapshot.
 * Independent requireFennDeskAccess — shell session is not API security.
 */
export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const fire = await getDeskFireSnapshot();
    return deskJson({ ok: true, fire });
  } catch (error) {
    return mapDeskGatheringError(error, "api/desk/fire");
  }
}
