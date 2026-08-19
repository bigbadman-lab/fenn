import { NextResponse } from "next/server";

import { getPublicOfficialFennToken } from "@/lib/treasury/official-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/home/official-token
 *
 * Live official $VELL contract for the homepage header.
 * Reads treasury_assets at request time — no deploy needed after launch:activate.
 */
export async function GET() {
  const token = await getPublicOfficialFennToken();
  return NextResponse.json(
    { ok: true as const, token },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
