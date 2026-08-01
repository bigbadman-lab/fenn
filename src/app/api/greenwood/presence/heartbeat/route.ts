import { NextResponse } from "next/server";

import { heartbeatFirePresence } from "@/lib/greenwood/presence/ops";
import {
  mapPresenceRouteError,
  rejectNonEmptyJsonBody,
  requireGreenwoodMemberPresence,
} from "@/lib/greenwood/presence/route-auth";

export const runtime = "nodejs";

/**
 * POST /api/greenwood/presence/heartbeat
 * Refresh Fire presence for the authenticated Greenwood member.
 * Empty body. Profile identity is never accepted from the client.
 */
export async function POST(request: Request) {
  try {
    const badBody = await rejectNonEmptyJsonBody(request);
    if (badBody) return badBody;

    const { profileId, admin } = await requireGreenwoodMemberPresence(request);
    const self = await heartbeatFirePresence(profileId, admin);

    return NextResponse.json(
      { ok: true, self },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapPresenceRouteError(
      error,
      "POST /api/greenwood/presence/heartbeat",
    );
  }
}
