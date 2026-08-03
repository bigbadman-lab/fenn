import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskDuplicateDeed } from "@/lib/desk/deed-definitions";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ deedId: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { deedId: raw } = await context.params;
    const deedId = raw.trim();
    if (!UUID_RE.test(deedId)) {
      return deskJson(
        { ok: false, error: "invalid_id", code: "invalid_id" },
        { status: 400 },
      );
    }
    const deed = await deskDuplicateDeed(deedId, identity);
    return deskJson({ ok: true, deed }, { status: 201 });
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/deeds/[deedId]/duplicate");
  }
}
