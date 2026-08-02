import { DeskAuthError, requireFennDeskAccess } from "@/lib/desk/auth";
import { loadSafeDeskKeeper } from "@/lib/desk/keeper";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

/**
 * Safe Keeper session for The Desk shell.
 * Pages still gate via client shell; this is not the sole protection boundary.
 * Future Desk APIs must call requireFennDeskAccess independently.
 */
export async function GET(request: Request) {
  try {
    const identity = await requireFennDeskAccess(request);
    const keeper = await loadSafeDeskKeeper(identity);
    return Response.json(
      {
        ok: true,
        keeper,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof DeskAuthError) {
      if (error.reason !== "unauthenticated" && error.reason !== "configuration_error") {
        console.info("[api/desk/session] denied", {
          reason: error.reason,
        });
      }
      if (error.reason === "configuration_error") {
        console.error("[api/desk/session] configuration_error");
      }
      return Response.json(
        { ok: false, error: "forbidden" },
        {
          status: error.status === 500 ? 500 : error.status,
          headers: NO_STORE_HEADERS,
        },
      );
    }
    console.error("[api/desk/session] unexpected error");
    return Response.json(
      { ok: false, error: "internal_error" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
