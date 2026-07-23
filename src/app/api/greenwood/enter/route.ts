import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { admitProfileToGreenwood } from "@/lib/greenwood/admission";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { LeafError } from "@/lib/leaf/errors";

export const runtime = "nodejs";

/**
 * POST /api/greenwood/enter
 * Atomic Stage 8.1 admission for the authenticated registered Outlaw.
 * No body. Profile ID is never accepted from the client.
 */
export async function POST(request: Request) {
  try {
    // Reject accidental client-supplied admission payloads.
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
            code: "greenwood_admission_failed",
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

    const result = await admitProfileToGreenwood(profile.id, admin);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return mapGreenwoodEnterError(error);
  }
}

function mapGreenwoodEnterError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: "Not authenticated", code: "unauthorized" },
      { status: 401 },
    );
  }
  if (error instanceof GreenwoodError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof LeafError) {
    return NextResponse.json(
      {
        error: "Greenwood admission failed",
        code: "greenwood_admission_failed",
      },
      { status: 500 },
    );
  }
  console.error("[POST /api/greenwood/enter]", error);
  return NextResponse.json(
    {
      error: "Internal server error",
      code: "greenwood_admission_failed",
    },
    { status: 500 },
  );
}
