import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { getDeskTreasurySnapshot } from "@/lib/desk/treasury";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const treasury = await getDeskTreasurySnapshot();
    return deskJson({ ok: true, treasury });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/treasury");
  }
}
