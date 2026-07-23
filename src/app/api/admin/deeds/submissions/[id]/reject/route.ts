import { NextResponse } from "next/server";
import { z } from "zod";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import {
  DeedModerationError,
  rejectDeedSubmission,
} from "@/lib/deeds/moderation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const rejectBodySchema = z
  .object({
    reviewNote: z.string().min(1).max(2000),
  })
  .strict();

export async function POST(request: Request, context: RouteContext) {
  try {
    const admin = await requireFennAdmin(request);
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "invalid_json" },
        { status: 400 },
      );
    }

    const parsed = rejectBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Review note required", code: "invalid_review_note" },
        { status: 422 },
      );
    }

    const result = await rejectDeedSubmission({
      submissionId: id,
      admin,
      reviewNote: parsed.data.reviewNote,
    });

    return NextResponse.json({ ok: true, result });
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
    console.error("[api/admin/deeds/reject]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "internal_error" },
      { status: 500 },
    );
  }
}
