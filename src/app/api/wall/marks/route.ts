import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { WallError } from "@/lib/wall/errors";
import { getMarkedEntryIdsForProfile } from "@/lib/wall/marks";
import { PUBLIC_WALL_ENTRIES_MAX_LIMIT } from "@/lib/wall/types";

export const runtime = "nodejs";

/**
 * GET /api/wall/marks?entries=id1,id2,...
 * Returns which of the requested entries the current Outlaw has marked.
 * Never exposes other profiles or reactor identities.
 */
export async function GET(request: Request) {
  try {
    const identity = await getVerifiedPrivyUser(request);
    const admin = createAdminClient();
    const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);

    if (!profile) {
      return NextResponse.json(
        {
          error: "Outlaw registration required",
          code: "outlaw_registration_required",
        },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const raw = url.searchParams.get("entries") ?? "";
    const entryIds = raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, PUBLIC_WALL_ENTRIES_MAX_LIMIT);

    const marked = await getMarkedEntryIdsForProfile(
      profile.id,
      entryIds,
      admin,
    );

    const marks: Record<string, boolean> = {};
    for (const id of entryIds) {
      marks[id] = marked.has(id);
    }

    return NextResponse.json({ ok: true, marks });
  } catch (error) {
    return mapWallMarksStatusError(error);
  }
}

function mapWallMarksStatusError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: "Not authenticated", code: "unauthorized" },
      { status: 401 },
    );
  }
  if (error instanceof WallError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error("[GET /api/wall/marks]", error);
  return NextResponse.json(
    {
      error: "Internal server error",
      code: "wall_mark_failed",
    },
    { status: 500 },
  );
}
