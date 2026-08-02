import { z } from "zod";

import { requireFennDeskAccess } from "@/lib/desk/auth";
import {
  DESK_DEED_DEFAULT_LIMIT,
  DESK_DEED_MAX_LIMIT,
  listDeskDeedSubmissions,
} from "@/lib/desk/deeds";
import type {
  DeskDeedEvidenceFilter,
  DeskDeedSort,
  DeskDeedStatusFilter,
} from "@/lib/desk/deeds-types";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z
    .enum(["pending", "approved", "rejected", "all"])
    .default("pending"),
  sort: z.enum(["oldest", "newest"]).default("oldest"),
  evidence: z
    .enum(["all", "image", "url", "text", "other"])
    .default("all"),
  greenwood: z.enum(["0", "1", "true", "false"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(DESK_DEED_MAX_LIMIT)
    .default(DESK_DEED_DEFAULT_LIMIT),
});

export async function GET(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      evidence: url.searchParams.get("evidence") ?? undefined,
      greenwood: url.searchParams.get("greenwood") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return deskJson({ ok: false, error: "invalid_query" }, { status: 400 });
    }
    const greenwoodOnly =
      parsed.data.greenwood === "1" || parsed.data.greenwood === "true";
    const page = await listDeskDeedSubmissions({
      status: parsed.data.status as DeskDeedStatusFilter,
      sort: parsed.data.sort as DeskDeedSort,
      evidence: parsed.data.evidence as DeskDeedEvidenceFilter,
      greenwoodOnly,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
    return deskJson({ ok: true, ...page });
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/deeds/submissions");
  }
}
