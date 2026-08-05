import { requireFennDeskAccess, DeskAuthError } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { getClearingDeskSnapshot } from "@/lib/clearing/desk-ops";
import { ClearingError } from "@/lib/clearing/errors";
import { getClearingHealth } from "@/lib/clearing/health";
import { clampClearingCursor } from "@/lib/clearing/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/clearing — Desk-only operator snapshot + health.
 */
export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const url = new URL(request.url);
    const filter = url.searchParams.get("filter");
    if (filter && filter.length > 32) {
      return deskJson(
        { ok: false, error: "Invalid filter", code: "clearing_invalid_request" },
        { status: 400 },
      );
    }
    const cursor = clampClearingCursor(url.searchParams.get("cursor"));
    const [snapshot, health] = await Promise.all([
      getClearingDeskSnapshot({ filter, cursor }),
      getClearingHealth(),
    ]);
    return deskJson({ ok: true, clearing: snapshot, health });
  } catch (error) {
    if (error instanceof DeskAuthError) {
      return deskJson(
        { ok: false, error: error.message, code: error.reason },
        { status: error.status },
      );
    }
    if (error instanceof ClearingError) {
      return deskJson(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[api/desk/clearing]", error);
    return deskJson(
      { ok: false, error: "Internal server error", code: "clearing_internal" },
      { status: 500 },
    );
  }
}
