import "server-only";

import { z } from "zod";

import { X_OAUTH_TWEETS_URL } from "@/lib/agent/execute-config";
import { X_HTTP_TIMEOUT_MS } from "@/lib/x/config";
import type { XHttpFetch } from "@/lib/x/client";
import { getXOauthClientConfig } from "@/lib/x/oauth-config";
import {
  accessTokenNeedsRefresh,
  fetchAuthenticatedXUser,
  loadXOauthCredentials,
  refreshAccessToken,
  upsertXOauthCredentials,
  type StoredXOauthCredentials,
} from "@/lib/x/oauth-tokens";

const createTweetResponseSchema = z.object({
  data: z.object({
    id: z.string().regex(/^\d+$/),
    text: z.string().optional(),
  }),
});

export type XReplyWriteResult =
  | { ok: true; tweetId: string }
  | {
      ok: false;
      class: "retryable" | "terminal" | "ambiguous";
      code: string;
      message: string;
    };

export type XWriteClientDeps = {
  fetchFn?: XHttpFetch;
  loadCredentials?: () => Promise<StoredXOauthCredentials | null>;
  saveCredentials?: typeof upsertXOauthCredentials;
  refresh?: typeof refreshAccessToken;
  timeoutMs?: number;
};

async function ensureFreshAccessToken(
  creds: StoredXOauthCredentials,
  deps: XWriteClientDeps,
): Promise<StoredXOauthCredentials> {
  if (!accessTokenNeedsRefresh(creds.expiresAt)) {
    return creds;
  }

  const refresh = deps.refresh ?? refreshAccessToken;
  const save = deps.saveCredentials ?? upsertXOauthCredentials;
  const rotated = await refresh(creds.refreshToken, { fetchFn: deps.fetchFn });

  await save({
    xUserId: creds.xUserId,
    xUsername: creds.xUsername,
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
    tokenType: rotated.tokenType,
    scope: rotated.scope,
    expiresAt: rotated.expiresAt,
  });

  return {
    ...creds,
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
    tokenType: rotated.tokenType,
    scope: rotated.scope,
    expiresAt: rotated.expiresAt?.toISOString() ?? null,
  };
}

async function postReplyOnce(
  accessToken: string,
  input: { text: string; replyToXPostId: string },
  deps: XWriteClientDeps,
): Promise<XReplyWriteResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? X_HTTP_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(X_OAUTH_TWEETS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        text: input.text,
        reply: { in_reply_to_tweet_id: input.replyToXPostId },
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        return {
          ok: false,
          class: "ambiguous",
          code: "x_invalid_response",
          message: "non-json reply response",
        };
      }
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        class: "retryable",
        code: "x_auth_expired",
        message: "access token rejected",
      };
    }

    if (response.status === 429) {
      return {
        ok: false,
        class: "retryable",
        code: "x_rate_limited",
        message: "rate limited",
      };
    }

    if (response.status >= 500) {
      return {
        ok: false,
        class: "retryable",
        code: "x_server_error",
        message: `HTTP ${response.status}`,
      };
    }

    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        class: "terminal",
        code: "x_api_error",
        message: `HTTP ${response.status}`,
      };
    }

    const parsed = createTweetResponseSchema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        class: "ambiguous",
        code: "x_invalid_response",
        message: "success payload missing tweet id",
      };
    }

    return { ok: true, tweetId: parsed.data.data.id };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"))
    ) {
      // Timeout after dispatch — reply may have been created. Do not auto-retry.
      return {
        ok: false,
        class: "ambiguous",
        code: "x_timeout_ambiguous",
        message: "timeout after reply dispatch",
      };
    }
    // Conservative: unknown network errors after POST started are ambiguous.
    return {
      ok: false,
      class: "ambiguous",
      code: "x_network_ambiguous",
      message: error instanceof Error ? error.message : "network failure",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST /2/tweets as @askfenn using persisted user-context OAuth.
 * At most one refresh + one retry on auth expiry. Never uses app-only Bearer.
 */
export async function createXReplyAsFenn(
  input: { text: string; replyToXPostId: string },
  deps: XWriteClientDeps = {},
): Promise<XReplyWriteResult> {
  if (!/^\d+$/.test(input.replyToXPostId.trim())) {
    return {
      ok: false,
      class: "terminal",
      code: "invalid_reply_target",
      message: "reply target must be digit snowflake",
    };
  }
  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    return {
      ok: false,
      class: "terminal",
      code: "empty_reply_text",
      message: "reply text required",
    };
  }

  const load = deps.loadCredentials ?? loadXOauthCredentials;
  let creds = await load();
  if (!creds) {
    return {
      ok: false,
      class: "terminal",
      code: "x_credentials_missing",
      message: "no @askfenn OAuth credentials bound",
    };
  }

  const expected = getXOauthClientConfig();
  if (creds.xUserId !== expected.fennXUserId) {
    return {
      ok: false,
      class: "terminal",
      code: "x_account_mismatch",
      message: "stored credentials are not the configured FENN X user",
    };
  }

  try {
    creds = await ensureFreshAccessToken(creds, deps);
  } catch {
    return {
      ok: false,
      class: "terminal",
      code: "x_refresh_failed",
      message: "token refresh failed",
    };
  }

  const first = await postReplyOnce(creds.accessToken, input, deps);
  if (first.ok) return first;
  if (first.code !== "x_auth_expired") return first;

  try {
    const refresh = deps.refresh ?? refreshAccessToken;
    const save = deps.saveCredentials ?? upsertXOauthCredentials;
    const rotated = await refresh(creds.refreshToken, { fetchFn: deps.fetchFn });
    await save({
      xUserId: creds.xUserId,
      xUsername: creds.xUsername,
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      tokenType: rotated.tokenType,
      scope: rotated.scope,
      expiresAt: rotated.expiresAt,
    });
    return await postReplyOnce(rotated.accessToken, input, deps);
  } catch {
    return {
      ok: false,
      class: "terminal",
      code: "x_refresh_failed",
      message: "refresh after auth rejection failed",
    };
  }
}

/** Safe operator check that stored tokens resolve to configured @askfenn. */
export async function verifyBoundXOauthIdentity(
  deps: XWriteClientDeps = {},
): Promise<
  | { ok: true; xUserId: string; username: string }
  | { ok: false; reason: string }
> {
  const load = deps.loadCredentials ?? loadXOauthCredentials;
  const creds = await load();
  if (!creds) return { ok: false, reason: "no credentials" };

  try {
    const fresh = await ensureFreshAccessToken(creds, deps);
    const me = await fetchAuthenticatedXUser(fresh.accessToken, {
      fetchFn: deps.fetchFn,
    });
    const expected = getXOauthClientConfig();
    if (me.id !== expected.fennXUserId) {
      return { ok: false, reason: "user id mismatch" };
    }
    return { ok: true, xUserId: me.id, username: me.username };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "verify failed",
    };
  }
}
