import "server-only";

import { z } from "zod";

import {
  X_OAUTH_CREDENTIAL_SLOT,
  X_OAUTH_TOKEN_URL,
  X_OAUTH_USERS_ME_URL,
} from "@/lib/agent/execute-config";
import {
  basicAuthHeader,
  getXOauthClientConfig,
  type XOAuthClientConfig,
} from "@/lib/x/oauth-config";
import { XError } from "@/lib/x/errors";
import type { XHttpFetch } from "@/lib/x/client";

const tokenResponseSchema = z.object({
  token_type: z.string().min(1),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
  scope: z.string().optional(),
});

const usersMeSchema = z.object({
  data: z.object({
    id: z.string().regex(/^\d+$/),
    username: z.string().min(1),
    name: z.string().optional(),
  }),
});

export type StoredXOauthCredentials = {
  id: string;
  xUserId: string;
  xUsername: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string | null;
  expiresAt: string | null;
};

type AdminLike = {
  from: (table: string) => unknown;
};

async function getAdmin(): Promise<AdminLike> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as AdminLike;
}

type TableChain = {
  select: (cols: string) => TableChain;
  eq: (col: string, val: string) => TableChain;
  maybeSingle: () => Promise<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>;
  upsert: (
    row: Record<string, unknown>,
    opts?: { onConflict?: string },
  ) => Promise<{ error: { message: string } | null }>;
  insert: (
    row: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>;
  update: (row: Record<string, unknown>) => {
    eq: (
      col: string,
      val: string,
    ) => Promise<{ error: { message: string } | null }>;
  };
  delete: () => {
    eq: (
      col: string,
      val: string,
    ) => Promise<{ error: { message: string } | null }>;
  };
};

function table(admin: AdminLike, name: string): TableChain {
  return admin.from(name) as TableChain;
}

export async function loadXOauthCredentials(
  deps: { admin?: AdminLike } = {},
): Promise<StoredXOauthCredentials | null> {
  const admin = deps.admin ?? (await getAdmin());
  const { data, error } = await table(admin, "x_oauth_credentials")
    .select(
      "id, x_user_id, x_username, access_token, refresh_token, token_type, scope, expires_at",
    )
    .eq("slot", X_OAUTH_CREDENTIAL_SLOT)
    .maybeSingle();

  if (error) {
    throw new XError("x_persist_failed", error.message, 500);
  }
  if (!data) return null;

  return {
    id: String(data.id),
    xUserId: String(data.x_user_id),
    xUsername: String(data.x_username),
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    tokenType: String(data.token_type ?? "bearer"),
    scope: typeof data.scope === "string" ? data.scope : null,
    expiresAt: typeof data.expires_at === "string" ? data.expires_at : null,
  };
}

export async function upsertXOauthCredentials(
  input: {
    xUserId: string;
    xUsername: string;
    accessToken: string;
    refreshToken: string;
    tokenType?: string;
    scope?: string | null;
    expiresAt?: Date | null;
  },
  deps: { admin?: AdminLike } = {},
): Promise<void> {
  const admin = deps.admin ?? (await getAdmin());
  const { error } = await table(admin, "x_oauth_credentials").upsert(
    {
      slot: X_OAUTH_CREDENTIAL_SLOT,
      x_user_id: input.xUserId,
      x_username: input.xUsername,
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
      token_type: input.tokenType ?? "bearer",
      scope: input.scope ?? null,
      expires_at: input.expiresAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "slot" },
  );

  if (error) {
    throw new XError("x_persist_failed", error.message, 500);
  }
}

export async function createPkceSession(
  input: {
    state: string;
    codeVerifier: string;
    actorId: string | null;
    expiresAt: Date;
  },
  deps: { admin?: AdminLike } = {},
): Promise<void> {
  const admin = deps.admin ?? (await getAdmin());
  const { error } = await table(admin, "x_oauth_pkce_sessions").insert({
    state: input.state,
    code_verifier: input.codeVerifier,
    actor_id: input.actorId,
    expires_at: input.expiresAt.toISOString(),
  });
  if (error) {
    throw new XError("x_persist_failed", error.message, 500);
  }
}

type RpcAdmin = AdminLike & {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export async function consumePkceSession(
  state: string,
  deps: { admin?: RpcAdmin } = {},
): Promise<{ codeVerifier: string } | null> {
  const admin = (deps.admin ?? (await getAdmin())) as RpcAdmin;
  const trimmed = state.trim();
  if (!trimmed) return null;

  const { data, error } = await admin.rpc("consume_x_oauth_pkce_session", {
    p_state: trimmed,
  });

  if (error) {
    throw new XError("x_persist_failed", error.message, 500);
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  if (typeof row.code_verifier !== "string") return null;
  return { codeVerifier: row.code_verifier };
}

async function postTokenForm(
  body: URLSearchParams,
  config: XOAuthClientConfig,
  fetchFn: XHttpFetch,
): Promise<z.infer<typeof tokenResponseSchema>> {
  const response = await fetchFn(X_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config.clientId, config.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    cache: "no-store",
  });

  const text = await response.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new XError("x_invalid_response", "token endpoint non-JSON", 502);
    }
  }

  if (response.status < 200 || response.status >= 300) {
    throw new XError(
      "x_auth_failed",
      "OAuth token exchange failed",
      response.status,
    );
  }

  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new XError("x_invalid_response", "OAuth token response invalid", 502);
  }
  return parsed.data;
}

export async function exchangeAuthorizationCode(
  input: { code: string; codeVerifier: string },
  deps: { fetchFn?: XHttpFetch; config?: XOAuthClientConfig } = {},
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  scope: string | null;
  tokenType: string;
}> {
  const config = deps.config ?? getXOauthClientConfig();
  const fetchFn = deps.fetchFn ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: config.redirectUri,
    code_verifier: input.codeVerifier,
  });

  const token = await postTokenForm(body, config, fetchFn);
  if (!token.refresh_token) {
    throw new XError(
      "x_auth_failed",
      "OAuth response missing refresh_token (offline.access required)",
      502,
    );
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type,
    scope: token.scope ?? null,
    expiresAt:
      typeof token.expires_in === "number"
        ? new Date(Date.now() + token.expires_in * 1000)
        : null,
  };
}

export async function refreshAccessToken(
  refreshToken: string,
  deps: { fetchFn?: XHttpFetch; config?: XOAuthClientConfig } = {},
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  scope: string | null;
  tokenType: string;
}> {
  const config = deps.config ?? getXOauthClientConfig();
  const fetchFn = deps.fetchFn ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const token = await postTokenForm(body, config, fetchFn);
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    tokenType: token.token_type,
    scope: token.scope ?? null,
    expiresAt:
      typeof token.expires_in === "number"
        ? new Date(Date.now() + token.expires_in * 1000)
        : null,
  };
}

export async function fetchAuthenticatedXUser(
  accessToken: string,
  deps: { fetchFn?: XHttpFetch } = {},
): Promise<{ id: string; username: string }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const response = await fetchFn(
    `${X_OAUTH_USERS_ME_URL}?user.fields=username,name`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  const text = await response.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new XError("x_invalid_response", "users/me non-JSON", 502);
    }
  }

  if (response.status < 200 || response.status >= 300) {
    throw new XError("x_auth_failed", "users/me failed", response.status);
  }

  const parsed = usersMeSchema.safeParse(json);
  if (!parsed.success) {
    throw new XError("x_invalid_response", "users/me payload invalid", 502);
  }

  return {
    id: parsed.data.data.id,
    username: parsed.data.data.username.toLowerCase(),
  };
}

/**
 * Verify token identity matches configured FENN_X_USER_ID before binding.
 */
export function assertFennXIdentity(
  user: { id: string; username: string },
  config: Pick<XOAuthClientConfig, "fennXUserId" | "fennXUsername">,
): void {
  if (user.id !== config.fennXUserId) {
    throw new XError(
      "x_account_mismatch",
      "OAuth identity does not match configured FENN_X_USER_ID",
      403,
    );
  }
  // Username is display-only confirmation; ID is authoritative.
  if (user.username !== config.fennXUsername) {
    throw new XError(
      "x_account_mismatch",
      "OAuth username does not match configured FENN_X_USERNAME",
      403,
    );
  }
}

/** Access token still usable? Refresh ~60s early. */
export function accessTokenNeedsRefresh(
  expiresAt: string | null,
  now = Date.now(),
): boolean {
  if (!expiresAt) return false;
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms <= now + 60_000;
}
