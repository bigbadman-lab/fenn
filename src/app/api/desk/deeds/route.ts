import { requireFennDeskAccess } from "@/lib/desk/auth";
import {
  deskCreateDeedDraft,
  deskListDeedDefinitions,
} from "@/lib/desk/deed-definitions";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { createDeedDraftSchema } from "@/lib/deeds/authoring-validation";
import type { DeedDefinitionFilter } from "@/lib/deeds/authoring";

export const dynamic = "force-dynamic";

const FILTERS = new Set<DeedDefinitionFilter>([
  "all",
  "draft",
  "active",
  "closed",
  "archived",
]);

export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const url = new URL(request.url);
    const raw = (url.searchParams.get("filter") ??
      "all") as DeedDefinitionFilter;
    if (!FILTERS.has(raw)) {
      return deskJson(
        { ok: false, error: "invalid_filter", code: "invalid_filter" },
        { status: 400 },
      );
    }
    const deeds = await deskListDeedDefinitions(raw);
    return deskJson({ ok: true, deeds });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/deeds");
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireFennDeskAccess(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return deskJson(
        { ok: false, error: "invalid_json", code: "invalid_json" },
        { status: 422 },
      );
    }
    const parsed = createDeedDraftSchema.safeParse(body);
    if (!parsed.success) {
      return deskJson(
        { ok: false, error: "invalid_body", code: "invalid_body" },
        { status: 422 },
      );
    }
    const deed = await deskCreateDeedDraft(parsed.data, identity);
    return deskJson({ ok: true, deed }, { status: 201 });
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/deeds");
  }
}
