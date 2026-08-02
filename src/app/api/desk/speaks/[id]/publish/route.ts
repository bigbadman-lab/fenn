import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { publishFireMessage } from "@/lib/greenwood/fire-messages";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/desk/speaks/[id]/publish */
export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { id } = await context.params;
    const admin = createAdminClient();
    const result = await publishFireMessage(
      id,
      identity.profileId,
      identity.actorId,
      admin,
    );
    return deskJson({ ok: true, result });
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/speaks/[id]/publish");
  }
}
