import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  X_OAUTH_AUTHORIZE_URL,
  X_OAUTH_PKCE_TTL_MS,
  X_OAUTH_SCOPES,
} from "@/lib/agent/execute-config";
import { XError } from "@/lib/x/errors";

export type XOAuthClientConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fennXUserId: string;
  fennXUsername: string;
};

function readOptionalEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Fixed callback path. Host comes from NEXT_PUBLIC_SITE_URL only —
 * never from request query/body (no open redirect).
 */
export function resolveXOauthRedirectUri(siteUrl: string): string {
  const base = siteUrl.trim().replace(/\/$/, "");
  if (!base) {
    throw new XError("x_config_invalid", "SITE_URL required for X OAuth", 500);
  }
  return `${base}/api/auth/x/callback`;
}

export function getXOauthClientConfig(): XOAuthClientConfig {
  const clientId = readOptionalEnv("X_OAUTH_CLIENT_ID");
  const clientSecret = readOptionalEnv("X_OAUTH_CLIENT_SECRET");
  const fennXUserId = readOptionalEnv("FENN_X_USER_ID");
  const usernameRaw = readOptionalEnv("FENN_X_USERNAME") || "thisisvell";
  const fennXUsername = usernameRaw.replace(/^@/, "").toLowerCase();
  const siteUrl = readOptionalEnv("NEXT_PUBLIC_SITE_URL");

  if (!clientId || !clientSecret) {
    throw new XError(
      "x_config_invalid",
      "X_OAUTH_CLIENT_ID and X_OAUTH_CLIENT_SECRET required",
      500,
    );
  }
  if (!fennXUserId || !/^\d+$/.test(fennXUserId)) {
    throw new XError(
      "x_config_invalid",
      "FENN_X_USER_ID must be configured as a digit string before OAuth binding",
      500,
    );
  }
  if (!siteUrl) {
    throw new XError(
      "x_config_invalid",
      "NEXT_PUBLIC_SITE_URL required for X OAuth redirect",
      500,
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri: resolveXOauthRedirectUri(siteUrl),
    fennXUserId,
    fennXUsername,
  };
}

export function generatePkcePair(): {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
} {
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { state, codeVerifier, codeChallenge };
}

export function buildXAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: X_OAUTH_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${X_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export function pkceExpiresAt(now = Date.now()): Date {
  return new Date(now + X_OAUTH_PKCE_TTL_MS);
}

export function basicAuthHeader(clientId: string, clientSecret: string): string {
  const raw = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString(
    "base64",
  );
  return `Basic ${raw}`;
}
