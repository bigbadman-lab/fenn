import { NextResponse } from "next/server";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import {
  DeedModerationError,
  listPendingDeedSubmissions,
} from "@/lib/deeds/moderation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireFennAdmin(request);
    const submissions = await listPendingDeedSubmissions();
    return NextResponse.json({ ok: true, submissions });
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
    console.error("[api/admin/deeds/submissions]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "internal_error" },
      { status: 500 },
    );
  }
}
