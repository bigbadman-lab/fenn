import { NextResponse } from "next/server";

import { getXOauthClientConfig } from "@/lib/x/oauth-config";
import {
  assertFennXIdentity,
  consumePkceSession,
  exchangeAuthorizationCode,
  fetchAuthenticatedXUser,
  upsertXOauthCredentials,
} from "@/lib/x/oauth-tokens";
import { XError } from "@/lib/x/errors";

export const runtime = "nodejs";

function htmlPage(title: string, body: string, status = 200): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="robots" content="noindex, nofollow"/>
<title>${title}</title>
<style>
  body { font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
         background: #0b0b0b; color: #e8e4d9; padding: 3rem 1.5rem; }
  h1 { font-size: 1.1rem; letter-spacing: 0.08em; }
  p { opacity: 0.85; max-width: 36rem; line-height: 1.5; }
</style>
</head>
<body>
  <h1>${title}</h1>
  <p>${body}</p>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Fixed X OAuth callback for FENN's own @askfenn account.
 * Validates PKCE state continuity, exchanges code, verifies X user id,
 * persists tokens. Never exposes tokens on the page.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const errorParam = url.searchParams.get("error");
    if (errorParam) {
      return htmlPage(
        "X LINK FAILED.",
        "Authorization was denied or failed.",
        400,
      );
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      return htmlPage(
        "X LINK FAILED.",
        "Missing authorization code or state.",
        400,
      );
    }

    const session = await consumePkceSession(state);
    if (!session) {
      return htmlPage(
        "X LINK FAILED.",
        "Invalid, expired, or already-used OAuth state.",
        400,
      );
    }

    const config = getXOauthClientConfig();
    const tokens = await exchangeAuthorizationCode({
      code,
      codeVerifier: session.codeVerifier,
    });

    const me = await fetchAuthenticatedXUser(tokens.accessToken);
    assertFennXIdentity(me, config);

    await upsertXOauthCredentials({
      xUserId: me.id,
      xUsername: me.username,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
      scope: tokens.scope,
      expiresAt: tokens.expiresAt,
    });

    return htmlPage(
      "X LINK ESTABLISHED.",
      `@${me.username}`,
      200,
    );
  } catch (error) {
    if (error instanceof XError && error.code === "x_account_mismatch") {
      return htmlPage(
        "X LINK REJECTED.",
        "Authorised X account does not match configured @askfenn identity.",
        403,
      );
    }
    console.error(
      "[api/auth/x/callback]",
      error instanceof Error ? error.message : "error",
    );
    return htmlPage(
      "X LINK FAILED.",
      "Could not complete X authorisation.",
      500,
    );
  }
}
