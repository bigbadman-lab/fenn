import { requireFennDeskAccess, DeskAuthError } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { getMarketWatchDeskSnapshot } from "@/lib/market-watch/desk-ops";
import { MarketWatchError } from "@/lib/market-watch/errors";
import { clampClearingCursor } from "@/lib/clearing/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/market-watch — Desk-only operator snapshot (read-only).
 * Query: filter, cursor
 */
export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const url = new URL(request.url);
    const filter = url.searchParams.get("filter");
    if (filter && filter.length > 32) {
      return deskJson(
        { ok: false, error: "Invalid filter", code: "mw_invalid_request" },
        { status: 400 },
      );
    }
    const cursor = clampClearingCursor(url.searchParams.get("cursor"));
    const snapshot = await getMarketWatchDeskSnapshot({ filter, cursor });
    return deskJson({ ok: true, marketWatch: snapshot });
  } catch (error) {
    if (error instanceof DeskAuthError) {
      return deskJson(
        { ok: false, error: error.message, code: error.reason },
        { status: error.status },
      );
    }
    if (error instanceof MarketWatchError) {
      return deskJson(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[api/desk/market-watch]", error);
    return deskJson(
      {
        ok: false,
        error: "Internal server error",
        code: "mw_internal",
      },
      { status: 500 },
    );
  }
}
