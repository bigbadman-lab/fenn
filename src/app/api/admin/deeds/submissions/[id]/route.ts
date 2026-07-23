import { NextResponse } from "next/server";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import {
  DeedModerationError,
  getDeedSubmissionForModeration,
} from "@/lib/deeds/moderation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireFennAdmin(request);
    const { id } = await context.params;
    const detail = await getDeedSubmissionForModeration(id);
    if (!detail) {
      return NextResponse.json(
        { error: "Not found", code: "not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, submission: detail });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json(
        { error: error.message, code: "forbidden" },
        { status: error.status },
      );
    }
    if (error instanceof DeedModerationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[api/admin/deeds/submissions/id]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "internal_error" },
      { status: 500 },
    );
  }
}
