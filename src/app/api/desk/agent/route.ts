import { requireFennDeskAccess } from "@/lib/desk/auth";
import { getDeskAgentHealth } from "@/lib/desk/agent";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const agent = await getDeskAgentHealth();
    return deskJson({ ok: true, agent });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/agent");
  }
}
