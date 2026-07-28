import { NextResponse } from "next/server";

import { AdminAuthError, requireFennAdmin } from "@/lib/admin/auth";
import {
  buildXAuthorizationUrl,
  generatePkcePair,
  getXOauthClientConfig,
  pkceExpiresAt,
} from "@/lib/x/oauth-config";
import { createPkceSession } from "@/lib/x/oauth-tokens";
import { XError } from "@/lib/x/errors";

export const runtime = "nodejs";

/**
 * Operator-only: start @askfenn OAuth 2.0 Authorization Code + PKCE.
 * Not public "Sign in with X".
 */
export async function GET(request: Request) {
  try {
    const admin = await requireFennAdmin(request);
    const config = getXOauthClientConfig();
    const pkce = generatePkcePair();

    await createPkceSession({
      state: pkce.state,
      codeVerifier: pkce.codeVerifier,
      actorId: admin.actorId,
      expiresAt: pkceExpiresAt(),
    });

    const url = buildXAuthorizationUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state: pkce.state,
      codeChallenge: pkce.codeChallenge,
    });

    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json(
        { error: error.message, code: "forbidden" },
        { status: error.status },
      );
    }
    if (error instanceof XError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[api/admin/x/oauth/start]", error instanceof Error ? error.message : "error");
    return NextResponse.json(
      { error: "Internal server error", code: "internal_error" },
      { status: 500 },
    );
  }
}
