import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { WallError } from "@/lib/wall/errors";
import { leaveWallMark } from "@/lib/wall/marks";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ entryId: string }>;
};

/**
 * POST /api/wall/[entryId]/mark
 * Permanent mark for the authenticated registered Outlaw.
 * No body required. Profile ID is never accepted from the client.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { entryId } = await context.params;

    // Reject accidental client-supplied authority payloads.
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      let body: unknown = null;
      try {
        body = await request.json();
      } catch {
        body = null;
      }
      if (
        body != null &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        Object.keys(body as object).length > 0
      ) {
        return NextResponse.json(
          {
            error: "Request body must be empty",
            code: "wall_mark_failed",
          },
          { status: 400 },
        );
      }
    }

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

    const result = await leaveWallMark(entryId, profile.id, admin);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return mapWallMarkError(error);
  }
}

function mapWallMarkError(error: unknown) {
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
  console.error("[POST /api/wall/[entryId]/mark]", error);
  return NextResponse.json(
    {
      error: "Internal server error",
      code: "wall_mark_failed",
    },
    { status: 500 },
  );
}
