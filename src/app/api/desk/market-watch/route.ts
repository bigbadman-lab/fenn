import { requireFennDeskAccess, DeskAuthError } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { getMarketWatchHealth } from "@/lib/market-watch/health";
import { MarketWatchError } from "@/lib/market-watch/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/market-watch — Desk-only worker health (no UI in 1.0A).
 */
export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const health = await getMarketWatchHealth();
    return deskJson({ ok: true, health });
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
