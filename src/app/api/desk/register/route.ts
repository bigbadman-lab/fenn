import { DeskAuthError, requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { listDeskRegisterMembers } from "@/lib/desk/register";
import {
  DeskRegisterQueryError,
  parseDeskRegisterQuery,
} from "@/lib/desk/register-query";

export const dynamic = "force-dynamic";

/**
 * Paginated Desk Register list.
 * Independent requireFennDeskAccess — shell session is not API security.
 */
export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const url = new URL(request.url);
    const query = parseDeskRegisterQuery(url.searchParams);
    const page = await listDeskRegisterMembers(query);
    return deskJson({ ok: true, ...page });
  } catch (error) {
    if (error instanceof DeskAuthError) {
      if (
        error.reason !== "unauthenticated" &&
        error.reason !== "configuration_error"
      ) {
        console.info("[api/desk/register] denied", { reason: error.reason });
      }
      return deskJson(
        { ok: false, error: "forbidden" },
        { status: error.status === 500 ? 500 : error.status },
      );
    }
    if (error instanceof DeskRegisterQueryError) {
      return deskJson({ ok: false, error: "invalid_query" }, { status: 400 });
    }
    console.error("[api/desk/register] unexpected error");
    return deskJson({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
