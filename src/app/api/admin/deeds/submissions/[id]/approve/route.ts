import { NextResponse } from "next/server";
import { z } from "zod";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import {
  DeedModerationError,
  approveDeedSubmission,
} from "@/lib/deeds/moderation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const approveBodySchema = z
  .object({
    leafAmount: z.number().int().optional().nullable(),
    reviewNote: z.string().max(2000).optional().nullable(),
  })
  .strict();

export async function POST(request: Request, context: RouteContext) {
  try {
    const admin = await requireFennAdmin(request);
    const { id } = await context.params;

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const parsed = approveBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", code: "invalid_json" },
        { status: 422 },
      );
    }

    const result = await approveDeedSubmission({
      submissionId: id,
      admin,
      leafAmount: parsed.data.leafAmount,
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
    console.error("[api/admin/deeds/approve]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "internal_error" },
      { status: 500 },
    );
  }
}
