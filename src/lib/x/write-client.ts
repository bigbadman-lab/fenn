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

/** Which POST /2/tweets attempt produced the failure (not a token phase). */
export type XWritePostPhase = "initial_post" | "post_refresh_retry";

/** Max length for failure `message` (incl. phase + status + x_error). */
export const X_WRITE_FAILURE_MESSAGE_MAX = 500;

const X_ERROR_KEEP_KEYS = [
  "title",
  "detail",
  "type",
  "status",
  "error",
  "error_description",
  "errors",
  "code",
  "reason",
] as const;

const SENSITIVE_KEY =
  /access[_-]?token|refresh[_-]?token|authorization|client[_-]?secret|code_verifier|pkce|password|cookie|bearer/i;

/** Scrub credential-shaped material from diagnostic strings. */
export function scrubCredentialMaterial(input: string): string {
  return input
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /\b(access_token|refresh_token|client_secret|code_verifier)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}/g, "[redacted-jwt]")
    .replace(/\s+/g, " ")
    .trim();
}

function redactSensitiveKeys(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubCredentialMaterial(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((v) => redactSensitiveKeys(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = redactSensitiveKeys(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Compact, credential-safe summary of an X API error body for operator logs.
 * Prefer well-known error fields; never include Authorization / tokens.
 */
export function sanitizeXWriteErrorBody(
  json: unknown,
  rawText: string,
  maxLen = 360,
): string {
  let summary = "";
  if (json !== null && json !== undefined) {
    if (typeof json === "object" && !Array.isArray(json)) {
      const src = json as Record<string, unknown>;
      const picked: Record<string, unknown> = {};
      for (const key of X_ERROR_KEEP_KEYS) {
        if (key in src && src[key] !== undefined) {
          picked[key] = src[key];
        }
      }
      const payload =
        Object.keys(picked).length > 0 ? picked : (json as Record<string, unknown>);
      try {
        summary = JSON.stringify(redactSensitiveKeys(payload));
      } catch {
        summary = "";
      }
    } else if (typeof json === "string") {
      summary = json;
    } else {
      try {
        summary = JSON.stringify(redactSensitiveKeys(json));
      } catch {
        summary = String(json);
      }
    }
  }
  if (!summary && rawText.trim().length > 0) {
    summary = rawText;
  }
  const scrubbed = scrubCredentialMaterial(summary);
  if (scrubbed.length <= maxLen) return scrubbed;
  return `${scrubbed.slice(0, Math.max(0, maxLen - 1))}…`;
}

/**
 * Operator-facing failure message fragment. Safe for cron logs + last_error.
 */
export function formatXWriteHttpFailureMessage(input: {
  base: string;
  phase: XWritePostPhase;
  status: number;
  statusText?: string;
  json?: unknown;
  rawText?: string;
}): string {
  const statusText = (input.statusText ?? "").trim().slice(0, 80);
  const xError = sanitizeXWriteErrorBody(
    input.json ?? null,
    input.rawText ?? "",
  );
  const parts = [
    input.base,
    `phase=${input.phase}`,
    `http_status=${input.status}`,
    statusText ? `status_text=${statusText}` : null,
    xError ? `x_error=${xError}` : null,
  ].filter(Boolean);
  const line = parts.join("; ");
  if (line.length <= X_WRITE_FAILURE_MESSAGE_MAX) return line;
  return `${line.slice(0, X_WRITE_FAILURE_MESSAGE_MAX - 1)}…`;
}

function emitXWriteDiagnostic(message: string): void {
  // stdout only — never tokens. Lands in Render cron logs.
  console.log(`[x-write] ${message}`);
}

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

function failWrite(
  result: Extract<XReplyWriteResult, { ok: false }>,
): Extract<XReplyWriteResult, { ok: false }> {
  emitXWriteDiagnostic(`${result.code}: ${result.message}`);
  return result;
}

async function postReplyOnce(
  accessToken: string,
  input: { text: string; replyToXPostId: string },
  deps: XWriteClientDeps,
  phase: XWritePostPhase,
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
        return failWrite({
          ok: false,
          class: "ambiguous",
          code: "x_invalid_response",
          message: formatXWriteHttpFailureMessage({
            base: "non-json reply response",
            phase,
            status: response.status,
            statusText: response.statusText,
            rawText: text,
          }),
        });
      }
    }

    if (response.status === 401 || response.status === 403) {
      return failWrite({
        ok: false,
        class: "retryable",
        code: "x_auth_expired",
        message: formatXWriteHttpFailureMessage({
          base: "access token rejected",
          phase,
          status: response.status,
          statusText: response.statusText,
          json,
          rawText: text,
        }),
      });
    }

    if (response.status === 429) {
      return failWrite({
        ok: false,
        class: "retryable",
        code: "x_rate_limited",
        message: formatXWriteHttpFailureMessage({
          base: "rate limited",
          phase,
          status: response.status,
          statusText: response.statusText,
          json,
          rawText: text,
        }),
      });
    }

    if (response.status >= 500) {
      return failWrite({
        ok: false,
        class: "retryable",
        code: "x_server_error",
        message: formatXWriteHttpFailureMessage({
          base: `HTTP ${response.status}`,
          phase,
          status: response.status,
          statusText: response.statusText,
          json,
          rawText: text,
        }),
      });
    }

    if (response.status < 200 || response.status >= 300) {
      return failWrite({
        ok: false,
        class: "terminal",
        code: "x_api_error",
        message: formatXWriteHttpFailureMessage({
          base: `HTTP ${response.status}`,
          phase,
          status: response.status,
          statusText: response.statusText,
          json,
          rawText: text,
        }),
      });
    }

    const parsed = createTweetResponseSchema.safeParse(json);
    if (!parsed.success) {
      return failWrite({
        ok: false,
        class: "ambiguous",
        code: "x_invalid_response",
        message: formatXWriteHttpFailureMessage({
          base: "success payload missing tweet id",
          phase,
          status: response.status,
          statusText: response.statusText,
          json,
          rawText: text,
        }),
      });
    }

    return { ok: true, tweetId: parsed.data.data.id };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"))
    ) {
      // Timeout after dispatch — reply may have been created. Do not auto-retry.
      return failWrite({
        ok: false,
        class: "ambiguous",
        code: "x_timeout_ambiguous",
        message: `timeout after reply dispatch; phase=${phase}`,
      });
    }
    // Conservative: unknown network errors after POST started are ambiguous.
    const raw =
      error instanceof Error ? error.message : "network failure";
    return failWrite({
      ok: false,
      class: "ambiguous",
      code: "x_network_ambiguous",
      message: `${scrubCredentialMaterial(raw)}; phase=${phase}`.slice(
        0,
        X_WRITE_FAILURE_MESSAGE_MAX,
      ),
    });
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
  } catch (error) {
    const detail =
      error instanceof Error
        ? scrubCredentialMaterial(error.message)
        : "token refresh failed";
    const message =
      `token refresh failed; phase=proactive_refresh; detail=${detail}`.slice(
        0,
        X_WRITE_FAILURE_MESSAGE_MAX,
      );
    return failWrite({
      ok: false,
      class: "terminal",
      code: "x_refresh_failed",
      message,
    });
  }

  const first = await postReplyOnce(
    creds.accessToken,
    input,
    deps,
    "initial_post",
  );
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
    return await postReplyOnce(
      rotated.accessToken,
      input,
      deps,
      "post_refresh_retry",
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? scrubCredentialMaterial(error.message)
        : "refresh after auth rejection failed";
    const message =
      `refresh after auth rejection failed; phase=forced_refresh; detail=${detail}`.slice(
        0,
        X_WRITE_FAILURE_MESSAGE_MAX,
      );
    return failWrite({
      ok: false,
      class: "terminal",
      code: "x_refresh_failed",
      message,
    });
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
      reason: error instanceof Error
        ? scrubCredentialMaterial(error.message)
        : "verify failed",
    };
  }
}
