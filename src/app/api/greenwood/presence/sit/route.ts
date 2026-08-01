import { NextResponse } from "next/server";

import { sitByTheFire } from "@/lib/greenwood/presence/ops";
import {
  mapPresenceRouteError,
  rejectNonEmptyJsonBody,
  requireGreenwoodMemberPresence,
} from "@/lib/greenwood/presence/route-auth";

export const runtime = "nodejs";

/**
 * POST /api/greenwood/presence/sit
 * Explicitly sit by The Fire. Empty body.
 */
export async function POST(request: Request) {
  try {
    const badBody = await rejectNonEmptyJsonBody(request);
    if (badBody) return badBody;

    const { profileId, admin } = await requireGreenwoodMemberPresence(request);
    const self = await sitByTheFire(profileId, admin);

    return NextResponse.json(
      { ok: true, self },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapPresenceRouteError(error, "POST /api/greenwood/presence/sit");
  }
}
