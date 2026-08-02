import { DeskAuthError, requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { getDeskOverview } from "@/lib/desk/overview";

export const dynamic = "force-dynamic";

/**
 * Desk overview attention signals.
 * Independent requireFennDeskAccess — shell session is not API security.
 */
export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const overview = await getDeskOverview();
    return deskJson({ ok: true, overview });
  } catch (error) {
    if (error instanceof DeskAuthError) {
      if (
        error.reason !== "unauthenticated" &&
        error.reason !== "configuration_error"
      ) {
        console.info("[api/desk/overview] denied", { reason: error.reason });
      }
      return deskJson(
        { ok: false, error: "forbidden" },
        { status: error.status === 500 ? 500 : error.status },
      );
    }
    console.error("[api/desk/overview] unexpected error");
    return deskJson({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
