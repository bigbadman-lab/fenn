import { requireFennDeskAccess } from "@/lib/desk/auth";
import {
  deskDeleteDeedDraft,
  deskGetDeedDefinition,
  deskUpdateDeedDraft,
} from "@/lib/desk/deed-definitions";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { updateDeedDraftSchema } from "@/lib/deeds/authoring-validation";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ deedId: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertDeedId(id: string): string | null {
  const value = id.trim();
  return UUID_RE.test(value) ? value : null;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireFennDeskAccess(_request);
    const { deedId: raw } = await context.params;
    const deedId = assertDeedId(raw);
    if (!deedId) {
      return deskJson(
        { ok: false, error: "invalid_id", code: "invalid_id" },
        { status: 400 },
      );
    }
    const deed = await deskGetDeedDefinition(deedId);
    if (!deed) {
      return deskJson(
        { ok: false, error: "not_found", code: "not_found" },
        { status: 404 },
      );
    }
    return deskJson({ ok: true, deed });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/deeds/[deedId]");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { deedId: raw } = await context.params;
    const deedId = assertDeedId(raw);
    if (!deedId) {
      return deskJson(
        { ok: false, error: "invalid_id", code: "invalid_id" },
        { status: 400 },
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return deskJson(
        { ok: false, error: "invalid_json", code: "invalid_json" },
        { status: 422 },
      );
    }
    const parsed = updateDeedDraftSchema.safeParse(body);
    if (!parsed.success) {
      return deskJson(
        { ok: false, error: "invalid_body", code: "invalid_body" },
        { status: 422 },
      );
    }
    const deed = await deskUpdateDeedDraft(deedId, parsed.data, identity);
    return deskJson({ ok: true, deed });
  } catch (error) {
    return mapDeskError(error, "PATCH /api/desk/deeds/[deedId]");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const identity = await requireFennDeskAccess(request);
    const { deedId: raw } = await context.params;
    const deedId = assertDeedId(raw);
    if (!deedId) {
      return deskJson(
        { ok: false, error: "invalid_id", code: "invalid_id" },
        { status: 400 },
      );
    }
    const result = await deskDeleteDeedDraft(deedId, identity);
    return deskJson({ ok: true, ...result });
  } catch (error) {
    return mapDeskError(error, "DELETE /api/desk/deeds/[deedId]");
  }
}
