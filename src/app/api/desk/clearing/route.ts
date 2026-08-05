import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { DeskAuthError } from "@/lib/desk/auth";
import { getClearingDeskSnapshot } from "@/lib/clearing/desk-ops";
import { ClearingError } from "@/lib/clearing/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/clearing — Desk-only operator snapshot.
 * Independent requireFennDeskAccess — layout gate is not API security.
 */
export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const url = new URL(request.url);
    const snapshot = await getClearingDeskSnapshot({
      filter: url.searchParams.get("filter"),
      cursor: url.searchParams.get("cursor"),
    });
    return deskJson({ ok: true, clearing: snapshot });
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
