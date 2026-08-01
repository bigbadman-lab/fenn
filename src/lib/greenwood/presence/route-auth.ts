import "server-only";

import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type GreenwoodPresenceAuth = {
  profileId: string;
  admin: SupabaseClient;
};

/**
 * Privy → profile → Greenwood membership.
 * Never trusts client profile/wallet identity.
 */
export async function requireGreenwoodMemberPresence(
  request: Request,
): Promise<GreenwoodPresenceAuth> {
  const identity = await getVerifiedPrivyUser(request);
  const admin = createAdminClient();
  const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);

  if (!profile) {
    throw new GreenwoodError(
      "outlaw_registration_required",
      "Outlaw registration required",
      403,
    );
  }

  if (profile.greenwood_entered_at == null) {
    throw new GreenwoodError(
      "greenwood_membership_required",
      "Greenwood membership required for Fire presence",
      403,
    );
  }

  return { profileId: profile.id, admin };
}

/** Reject accidental client-supplied identity payloads. */
export async function rejectNonEmptyJsonBody(
  request: Request,
): Promise<NextResponse | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

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
        code: "greenwood_presence_failed",
      },
      { status: 400 },
    );
  }

  return null;
}

export function mapPresenceRouteError(error: unknown, label: string) {
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
  console.error(`[${label}]`, error);
  return NextResponse.json(
    { error: "Internal server error", code: "greenwood_presence_failed" },
    { status: 500 },
  );
}
