import { NextResponse } from "next/server";

import { getFirePresenceSnapshot } from "@/lib/greenwood/presence/ops";
import {
  mapPresenceRouteError,
  requireGreenwoodMemberPresence,
} from "@/lib/greenwood/presence/route-auth";

export const runtime = "nodejs";

/**
 * GET /api/greenwood/presence
 * Active Fire presence for Greenwood members only.
 * Never exposes wallets, profile IDs, or expired heartbeats.
 */
export async function GET(request: Request) {
  try {
    const { profileId, admin } = await requireGreenwoodMemberPresence(request);
    const presence = await getFirePresenceSnapshot(profileId, admin);

    return NextResponse.json(
      { ok: true, presence },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapPresenceRouteError(error, "GET /api/greenwood/presence");
  }
}
