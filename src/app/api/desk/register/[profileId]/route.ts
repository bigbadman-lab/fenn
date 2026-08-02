import { DeskAuthError, requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { getDeskRegisterMember } from "@/lib/desk/register";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ profileId: string }>;
};

/**
 * Desk Register member detail.
 * Profile ID selects the inspected member only after Desk access succeeds.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    await requireFennDeskAccess(request);
    const { profileId } = await context.params;
    const member = await getDeskRegisterMember(profileId);
    if (!member) {
      return deskJson({ ok: false, error: "not_found" }, { status: 404 });
    }
    return deskJson({ ok: true, member });
  } catch (error) {
    if (error instanceof DeskAuthError) {
      if (
        error.reason !== "unauthenticated" &&
        error.reason !== "configuration_error"
      ) {
        console.info("[api/desk/register/detail] denied", {
          reason: error.reason,
        });
      }
      return deskJson(
        { ok: false, error: "forbidden" },
        { status: error.status === 500 ? 500 : error.status },
      );
    }
    console.error("[api/desk/register/detail] unexpected error");
    return deskJson({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
