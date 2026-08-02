import { requireFennDeskAccess } from "@/lib/desk/auth";
import { getDeskBookHealth } from "@/lib/desk/book";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const book = await getDeskBookHealth();
    return deskJson({ ok: true, book });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/book");
  }
}
