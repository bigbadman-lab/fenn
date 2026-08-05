import { NextResponse } from "next/server";

import { getClearingFeed } from "@/lib/clearing/feed";
import { ClearingError } from "@/lib/clearing/errors";
import { logClearing } from "@/lib/clearing/log";
import { clampClearingCursor } from "@/lib/clearing/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/clearing/feed — public published messages only.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");
    const cursor = clampClearingCursor(url.searchParams.get("cursor"));

    const page = await getClearingFeed({
      limit,
      cursor,
    });

    return NextResponse.json(
      {
        ok: true,
        items: page.items,
        nextCursor: page.nextCursor,
        state: page.state ?? { readOnly: false, slowModeSeconds: 0 },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof ClearingError) {
      logClearing({
        event: "feed_fail",
        ok: false,
        code: error.code,
      });
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    logClearing({ event: "feed_fail", ok: false, code: "clearing_internal" });
    console.error("[api/clearing/feed]", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "clearing_internal" },
      { status: 500 },
    );
  }
}
