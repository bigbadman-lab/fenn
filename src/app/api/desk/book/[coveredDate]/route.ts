import { requireFennDeskAccess } from "@/lib/desk/auth";
import { getDeskBookEntryByDate } from "@/lib/desk/book";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ coveredDate: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireFennDeskAccess(request);
    const { coveredDate } = await context.params;
    const entry = await getDeskBookEntryByDate(coveredDate);
    if (!entry) {
      return deskJson({ ok: false, error: "not_found" }, { status: 404 });
    }
    return deskJson({ ok: true, entry });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/book/[coveredDate]");
  }
}
