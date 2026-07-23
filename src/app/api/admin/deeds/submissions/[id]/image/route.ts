import { NextResponse } from "next/server";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import {
  DeedModerationError,
  signSubmissionEvidenceImage,
} from "@/lib/deeds/moderation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Short-lived signed URL for submission image evidence.
 * Path always loaded from the submission row — never from client input.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    await requireFennAdmin(request);
    const { id } = await context.params;
    const signed = await signSubmissionEvidenceImage(id);
    return NextResponse.json({ ok: true, ...signed });
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
    console.error("[api/admin/deeds/image]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "internal_error" },
      { status: 500 },
    );
  }
}
