import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  validateReplyEffectPayload,
  validateWallEffectPayload,
} from "@/lib/agent/effect-payload";
import {
  executeOneXPerceptionEffect,
  executePendingXPerceptionEffects,
  formatExecuteBatchReport,
} from "@/lib/agent/stage126-execute";
import { stage12WallSourceExternalId } from "@/lib/wall/stage12-tool-contract";
import { WallError } from "@/lib/wall/errors";
import {
  assertFennXIdentity,
  accessTokenNeedsRefresh,
} from "@/lib/x/oauth-tokens";
import {
  generatePkcePair,
  buildXAuthorizationUrl,
  resolveXOauthRedirectUri,
} from "@/lib/x/oauth-config";
import {
  createXReplyAsFenn,
  formatXWriteHttpFailureMessage,
  isXReplyTargetUnavailableError,
  sanitizeXWriteErrorBody,
} from "@/lib/x/write-client";
import { XError } from "@/lib/x/errors";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

const TREE_ASCII = [
  "        /\\",
  "       /  \\",
  "      /____\\",
  "        ||",
].join("\n");

const FENN_ID = "2079877030821208064";
const POST_ID = "1848332198301234567";

describe("Stage 12.6 effect payload validation", () => {
  it("accepts trusted reply payload and rejects tampered target", () => {
    const ok = validateReplyEffectPayload(
      { replyToXPostId: POST_ID, text: "The woods remember." },
      POST_ID,
    );
    assert.equal(ok.replyToXPostId, POST_ID);

    assert.throws(() =>
      validateReplyEffectPayload(
        { replyToXPostId: "999", text: "nope" },
        POST_ID,
      ),
    );
  });

  it("locks Wall provenance and preserves ASCII body", () => {
    const ok = validateWallEffectPayload(
      {
        body: TREE_ASCII,
        sourceType: "x_agent",
        sourceExternalId: stage12WallSourceExternalId(POST_ID),
      },
      POST_ID,
    );
    assert.equal(ok.body, TREE_ASCII);
    assert.equal(ok.sourceType, "x_agent");

    assert.throws(() =>
      validateWallEffectPayload(
        {
          body: TREE_ASCII,
          sourceType: "admin",
          sourceExternalId: stage12WallSourceExternalId(POST_ID),
        },
        POST_ID,
      ),
    );
    assert.throws(() =>
      validateWallEffectPayload(
        {
          body: TREE_ASCII,
          sourceType: "x_agent",
          sourceExternalId: "other:wall",
        },
        POST_ID,
      ),
    );
  });
});

describe("Stage 12.6 OAuth helpers", () => {
  it("generates PKCE S256 pair and builds authorize URL", () => {
    const pkce = generatePkcePair();
    assert.ok(pkce.state.length >= 16);
    assert.ok(pkce.codeVerifier.length >= 43);
    assert.ok(pkce.codeChallenge.length >= 40);
    assert.notEqual(pkce.codeVerifier, pkce.codeChallenge);

    const url = buildXAuthorizationUrl({
      clientId: "cid",
      redirectUri: "https://askvell.com/api/auth/x/callback",
      state: pkce.state,
      codeChallenge: pkce.codeChallenge,
    });
    assert.match(url, /code_challenge_method=S256/);
    assert.match(url, /tweet\.write/);
    assert.match(url, /offline\.access/);
  });

  it("resolves redirect from site URL only", () => {
    assert.equal(
      resolveXOauthRedirectUri("https://askvell.com/"),
      "https://askvell.com/api/auth/x/callback",
    );
  });

  it("rejects wrong X account identity", () => {
    assert.throws(
      () =>
        assertFennXIdentity(
          { id: "1", username: "someone" },
          { fennXUserId: FENN_ID, fennXUsername: "thisisvell" },
        ),
      (err: unknown) =>
        err instanceof XError && err.code === "x_account_mismatch",
    );
  });

  it("detects access token refresh window", () => {
    assert.equal(accessTokenNeedsRefresh(null), false);
    assert.equal(
      accessTokenNeedsRefresh(new Date(Date.now() + 120_000).toISOString()),
      false,
    );
    assert.equal(
      accessTokenNeedsRefresh(new Date(Date.now() + 10_000).toISOString()),
      true,
    );
  });
});

describe("Stage 12.6 X write client", () => {
  const prev = {
    clientId: process.env.X_OAUTH_CLIENT_ID,
    clientSecret: process.env.X_OAUTH_CLIENT_SECRET,
    userId: process.env.FENN_X_USER_ID,
    username: process.env.FENN_X_USERNAME,
    site: process.env.NEXT_PUBLIC_SITE_URL,
  };

  function setOauthEnv() {
    process.env.X_OAUTH_CLIENT_ID = "cid";
    process.env.X_OAUTH_CLIENT_SECRET = "sec";
    process.env.FENN_X_USER_ID = FENN_ID;
    process.env.FENN_X_USERNAME = "thisisvell";
    process.env.NEXT_PUBLIC_SITE_URL = "https://askvell.com";
  }

  function restoreOauthEnv() {
    for (const [key, value] of Object.entries({
      X_OAUTH_CLIENT_ID: prev.clientId,
      X_OAUTH_CLIENT_SECRET: prev.clientSecret,
      FENN_X_USER_ID: prev.userId,
      FENN_X_USERNAME: prev.username,
      NEXT_PUBLIC_SITE_URL: prev.site,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  it("posts exact reply once and stores tweet id", async () => {
    setOauthEnv();
    try {
    let calls = 0;
    const result = await createXReplyAsFenn(
      { text: "hello woods", replyToXPostId: POST_ID },
      {
        loadCredentials: async () => ({
          id: "c1",
          xUserId: FENN_ID,
          xUsername: "thisisvell",
          accessToken: "access",
          refreshToken: "refresh",
          tokenType: "bearer",
          scope: "tweet.write",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
        fetchFn: async (_url, init) => {
          calls += 1;
          assert.equal(init?.method, "POST");
          const body = JSON.parse(String(init?.body)) as {
            text: string;
            reply: { in_reply_to_tweet_id: string };
          };
          assert.equal(body.text, "hello woods");
          assert.equal(body.reply.in_reply_to_tweet_id, POST_ID);
          return new Response(JSON.stringify({ data: { id: "9001", text: "hello woods" } }), {
            status: 201,
          });
        },
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.tweetId, "9001");
    assert.equal(calls, 1);
    } finally {
      restoreOauthEnv();
    }
  });

  it("refreshes once on 401 then retries exact reply", async () => {
    setOauthEnv();
    try {
    let posts = 0;
    let refreshes = 0;
    let savedRefresh: string | null = null;

    const result = await createXReplyAsFenn(
      { text: "retry", replyToXPostId: POST_ID },
      {
        loadCredentials: async () => ({
          id: "c1",
          xUserId: FENN_ID,
          xUsername: "thisisvell",
          accessToken: "stale",
          refreshToken: "r1",
          tokenType: "bearer",
          scope: null,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
        saveCredentials: async (input) => {
          savedRefresh = input.refreshToken;
        },
        refresh: async () => {
          refreshes += 1;
          return {
            accessToken: "fresh",
            refreshToken: "r2",
            tokenType: "bearer",
            scope: null,
            expiresAt: new Date(Date.now() + 3600_000),
          };
        },
        fetchFn: async (url, init) => {
          if (String(url).includes("/2/tweets")) {
            posts += 1;
            if (posts === 1) {
              return new Response("{}", { status: 401 });
            }
            const auth = String(
              (init?.headers as Record<string, string>)?.Authorization ?? "",
            );
            assert.match(auth, /fresh/);
            return new Response(
              JSON.stringify({ data: { id: "9002" } }),
              { status: 201 },
            );
          }
          throw new Error(`unexpected ${url}`);
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(posts, 2);
    assert.equal(refreshes, 1);
    assert.equal(savedRefresh, "r2");
    } finally {
      restoreOauthEnv();
    }
  });

  it("classifies 429 as retryable without looping", async () => {
    setOauthEnv();
    try {
    let posts = 0;
    const result = await createXReplyAsFenn(
      { text: "wait", replyToXPostId: POST_ID },
      {
        loadCredentials: async () => ({
          id: "c1",
          xUserId: FENN_ID,
          xUsername: "thisisvell",
          accessToken: "access",
          refreshToken: "r1",
          tokenType: "bearer",
          scope: null,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
        fetchFn: async () => {
          posts += 1;
          return new Response("{}", { status: 429 });
        },
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.class, "retryable");
      assert.equal(result.code, "x_rate_limited");
    }
    assert.equal(posts, 1);
    } finally {
      restoreOauthEnv();
    }
  });

  it("marks timeout after dispatch as ambiguous (no blind retry)", async () => {
    setOauthEnv();
    try {
    const result = await createXReplyAsFenn(
      { text: "maybe", replyToXPostId: POST_ID },
      {
        loadCredentials: async () => ({
          id: "c1",
          xUserId: FENN_ID,
          xUsername: "thisisvell",
          accessToken: "access",
          refreshToken: "r1",
          tokenType: "bearer",
          scope: null,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
        fetchFn: async () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        },
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.class, "ambiguous");
    } finally {
      restoreOauthEnv();
    }
  });

  it("401 diagnostics include status and keep retryable x_auth_expired after post-refresh still fails", async () => {
    setOauthEnv();
    try {
      const accessToken = "secret-access-token-value-xyz";
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };
      try {
        const result = await createXReplyAsFenn(
          { text: "auth", replyToXPostId: POST_ID },
          {
            loadCredentials: async () => ({
              id: "c1",
              xUserId: FENN_ID,
              xUsername: "thisisvell",
              accessToken,
              refreshToken: "secret-refresh-token-value-xyz",
              tokenType: "bearer",
              scope: null,
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            }),
            saveCredentials: async () => {},
            refresh: async () => ({
              accessToken: "rotated-access-token-zzz",
              refreshToken: "rotated-refresh-token-zzz",
              tokenType: "bearer",
              scope: null,
              expiresAt: new Date(Date.now() + 3600_000),
            }),
            fetchFn: async () =>
              new Response(
                JSON.stringify({
                  title: "Unauthorized",
                  detail: "Unauthorized",
                  type: "about:blank",
                  status: 401,
                }),
                { status: 401, statusText: "Unauthorized" },
              ),
          },
        );
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.class, "retryable");
          assert.equal(result.code, "x_auth_expired");
          assert.match(result.message, /phase=post_refresh_retry/);
          assert.match(result.message, /http_status=401/);
          assert.match(result.message, /status_text=Unauthorized/);
          assert.match(result.message, /x_error=/);
          assert.match(result.message, /Unauthorized/);
          assert.doesNotMatch(result.message, /secret-access-token-value-xyz/);
          assert.doesNotMatch(result.message, /secret-refresh-token-value-xyz/);
          assert.doesNotMatch(result.message, /rotated-access-token-zzz/);
          assert.doesNotMatch(result.message, /Bearer\s+/i);
        }
        const joined = logs.join("\n");
        assert.match(joined, /phase=initial_post/);
        assert.match(joined, /phase=post_refresh_retry/);
        assert.doesNotMatch(joined, /secret-access-token-value-xyz/);
        assert.doesNotMatch(joined, /rotated-access-token-zzz/);
      } finally {
        console.log = originalLog;
      }
    } finally {
      restoreOauthEnv();
    }
  });

  it("403 deleted/not-visible target is terminal x_reply_target_unavailable without refresh", async () => {
    setOauthEnv();
    try {
      let posts = 0;
      let refreshes = 0;
      const accessToken = "valid-access-token-alive";
      const result = await createXReplyAsFenn(
        { text: "ghost reply", replyToXPostId: POST_ID },
        {
          loadCredentials: async () => ({
            id: "c1",
            xUserId: FENN_ID,
            xUsername: "thisisvell",
            accessToken,
            refreshToken: "valid-refresh-token-alive",
            tokenType: "bearer",
            scope: "tweet.write",
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
          saveCredentials: async () => {
            throw new Error("must not save credentials");
          },
          refresh: async () => {
            refreshes += 1;
            throw new Error("must not refresh");
          },
          fetchFn: async () => {
            posts += 1;
            return new Response(
              JSON.stringify({
                title: "Forbidden",
                detail:
                  "You attempted to reply to a Tweet that is deleted or not visible to you.",
                type: "about:blank",
                status: 403,
              }),
              { status: 403, statusText: "Forbidden" },
            );
          },
        },
      );
      assert.equal(posts, 1);
      assert.equal(refreshes, 0);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.class, "terminal");
        assert.equal(result.code, "x_reply_target_unavailable");
        assert.match(result.message, /phase=initial_post/);
        assert.match(result.message, /http_status=403/);
        assert.match(result.message, /deleted or not visible/);
        assert.doesNotMatch(result.message, /valid-access-token-alive/);
        assert.doesNotMatch(result.message, /valid-refresh-token-alive/);
      }
    } finally {
      restoreOauthEnv();
    }
  });

  it("generic 403 is terminal x_forbidden without oauth refresh/retry", async () => {
    setOauthEnv();
    try {
      let posts = 0;
      let refreshes = 0;
      const result = await createXReplyAsFenn(
        { text: "forbidden", replyToXPostId: POST_ID },
        {
          loadCredentials: async () => ({
            id: "c1",
            xUserId: FENN_ID,
            xUsername: "thisisvell",
            accessToken: "access-token-aaa",
            refreshToken: "refresh-token-bbb",
            tokenType: "bearer",
            scope: "tweet.write",
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
          saveCredentials: async () => {
            throw new Error("must not save");
          },
          refresh: async () => {
            refreshes += 1;
            throw new Error("must not refresh");
          },
          fetchFn: async () => {
            posts += 1;
            return new Response(
              JSON.stringify({
                title: "Forbidden",
                detail: "You are not permitted to perform this action.",
                type: "about:blank",
                status: 403,
                errors: [{ message: "You cannot reply to this post" }],
              }),
              { status: 403, statusText: "Forbidden" },
            );
          },
        },
      );
      assert.equal(posts, 1);
      assert.equal(refreshes, 0);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.class, "terminal");
        assert.equal(result.code, "x_forbidden");
        assert.notEqual(result.code, "x_auth_expired");
        assert.match(result.message, /phase=initial_post/);
        assert.match(result.message, /http_status=403/);
        assert.match(result.message, /You are not permitted/);
        assert.doesNotMatch(result.message, /access-token-aaa|refresh-token-bbb/);
      }
    } finally {
      restoreOauthEnv();
    }
  });

  it("long X error body is truncated and never includes Authorization tokens", async () => {
    setOauthEnv();
    try {
      const longDetail = "x".repeat(2000);
      const result = await createXReplyAsFenn(
        { text: "long", replyToXPostId: POST_ID },
        {
          loadCredentials: async () => ({
            id: "c1",
            xUserId: FENN_ID,
            xUsername: "thisisvell",
            accessToken: "tok_live_should_not_appear",
            refreshToken: "ref_live_should_not_appear",
            tokenType: "bearer",
            scope: null,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
          saveCredentials: async () => {
            throw new Error("must not save");
          },
          refresh: async () => {
            throw new Error("must not refresh");
          },
          fetchFn: async () =>
            new Response(
              JSON.stringify({
                title: "Error",
                detail: longDetail,
                access_token: "tok_live_should_not_appear",
                Authorization: "Bearer tok_live_should_not_appear",
              }),
              { status: 403 },
            ),
        },
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "x_forbidden");
        assert.equal(result.class, "terminal");
        assert.ok(result.message.length <= 500);
        assert.match(result.message, /…$/);
        assert.doesNotMatch(result.message, /tok_live_should_not_appear/);
        assert.doesNotMatch(result.message, /ref_live_should_not_appear/);
        assert.doesNotMatch(result.message, /Bearer tok_live/i);
      }
    } finally {
      restoreOauthEnv();
    }
  });

  it("second POST after successful refresh is marked post_refresh_retry", async () => {
    setOauthEnv();
    try {
      let posts = 0;
      const result = await createXReplyAsFenn(
        { text: "retry diag", replyToXPostId: POST_ID },
        {
          loadCredentials: async () => ({
            id: "c1",
            xUserId: FENN_ID,
            xUsername: "thisisvell",
            accessToken: "stale-access-token-111",
            refreshToken: "stale-refresh-token-222",
            tokenType: "bearer",
            scope: null,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
          saveCredentials: async () => {},
          refresh: async () => ({
            accessToken: "fresh-access-token-333",
            refreshToken: "fresh-refresh-token-444",
            tokenType: "bearer",
            scope: null,
            expiresAt: new Date(Date.now() + 3600_000),
          }),
          fetchFn: async () => {
            posts += 1;
            return new Response(
              JSON.stringify({
                title: "Unauthorized",
                detail: posts === 1 ? "first" : "still unauthorized after refresh",
                status: 401,
              }),
              { status: 401, statusText: "Unauthorized" },
            );
          },
        },
      );
      assert.equal(posts, 2);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.class, "retryable");
        assert.equal(result.code, "x_auth_expired");
        assert.match(result.message, /phase=post_refresh_retry/);
        assert.match(result.message, /http_status=401/);
        assert.match(result.message, /still unauthorized after refresh/);
        assert.doesNotMatch(result.message, /stale-access-token-111/);
        assert.doesNotMatch(result.message, /fresh-access-token-333/);
        assert.doesNotMatch(result.message, /stale-refresh-token-222/);
        assert.doesNotMatch(result.message, /fresh-refresh-token-444/);
      }
    } finally {
      restoreOauthEnv();
    }
  });

  it("detects X reply-target unavailable detail copy", () => {
    assert.equal(
      isXReplyTargetUnavailableError(
        {
          title: "Forbidden",
          detail:
            "You attempted to reply to a Tweet that is deleted or not visible to you.",
          status: 403,
        },
        "",
      ),
      true,
    );
    assert.equal(
      isXReplyTargetUnavailableError(
        { title: "Forbidden", detail: "You are not permitted." },
        "",
      ),
      false,
    );
  });

  it("sanitize helpers redact tokens and preserve X error fields", () => {
    const body = {
      title: "Forbidden",
      detail: "Nope",
      type: "about:blank",
      status: 403,
      access_token: "should-not-leak",
      Authorization: "Bearer should-not-leak",
    };
    const sanitized = sanitizeXWriteErrorBody(body, "");
    assert.match(sanitized, /Forbidden/);
    assert.match(sanitized, /Nope/);
    // Sensitive keys are dropped / redacted — never emitted as secret values.
    assert.doesNotMatch(sanitized, /should-not-leak/);
    assert.doesNotMatch(sanitized, /Bearer\s+should/i);

    const withOnlySecrets = sanitizeXWriteErrorBody(
      {
        access_token: "should-not-leak",
        Authorization: "Bearer should-not-leak",
        other: "visible-ok",
      },
      "",
    );
    assert.match(withOnlySecrets, /visible-ok|\[redacted\]/);
    assert.doesNotMatch(withOnlySecrets, /should-not-leak/);

    const long = sanitizeXWriteErrorBody(
      { detail: "y".repeat(1000) },
      "",
      80,
    );
    assert.ok(long.length <= 80);
    assert.match(long, /…$/);

    const msg = formatXWriteHttpFailureMessage({
      base: "access token rejected",
      phase: "initial_post",
      status: 403,
      statusText: "Forbidden",
      json: body,
    });
    assert.match(msg, /phase=initial_post/);
    assert.match(msg, /http_status=403/);
    assert.doesNotMatch(msg, /should-not-leak/);
  });
});

describe("Stage 12.6 executor", () => {
  function makeAdmin(effects: Array<Record<string, unknown>>) {
    const store = effects.map((e) => ({ ...e }));
    let xCalls = 0;
    let wallCalls = 0;
    const wallBodies: string[] = [];

    const admin = {
      xCalls: () => xCalls,
      wallCalls: () => wallCalls,
      wallBodies,
      store,
      from() {
        throw new Error("from unused");
      },
      async rpc(fn: string, args?: Record<string, unknown>) {
        if (fn === "list_pending_x_perception_effects") {
          const types = Array.isArray(args?.p_effect_types)
            ? (args.p_effect_types as string[])
            : null;
          const rows = store
            .filter((e) => {
              const executable =
                e.status === "pending" ||
                (e.status === "failed" && e.failure_class === "retryable");
              if (!executable) return false;
              if (types && types.length > 0 && !types.includes(e.effect_type)) {
                return false;
              }
              return true;
            })
            .map((e) => ({
              effect_id: e.id,
              effect_type: e.effect_type,
              idempotency_key: e.idempotency_key,
              status: e.status,
              failure_class: e.failure_class ?? null,
              attempt_count: e.attempt_count,
              x_post_id: e.x_post_id,
              created_at: e.created_at,
              payload_preview: "…",
            }));
          return {
            data: rows,
            error: null,
          };
        }

        if (fn === "claim_x_perception_effect") {
          const xPostFilter =
            typeof args?.p_x_post_id === "string" ? args.p_x_post_id : null;
          const typeFilter = Array.isArray(args?.p_effect_types)
            ? (args.p_effect_types as string[]).filter(
                (t) => typeof t === "string" && t.length > 0,
              )
            : [];
          if (typeFilter.length === 0) return { data: [], error: null };
          const idx = store.findIndex((e) => {
            const executable =
              e.status === "pending" ||
              (e.status === "failed" && e.failure_class === "retryable");
            if (!executable) return false;
            if (xPostFilter && e.x_post_id !== xPostFilter) return false;
            if (!typeFilter.includes(e.effect_type)) return false;
            return true;
          });
          if (idx < 0) return { data: [], error: null };
          const e = store[idx]!;
          e.status = "processing";
          e.attempt_count = Number(e.attempt_count ?? 0) + 1;
          return {
            data: [
              {
                effect_id: e.id,
                authorization_id: e.authorization_id,
                perception_event_id: e.perception_event_id,
                effect_type: e.effect_type,
                idempotency_key: e.idempotency_key,
                payload: e.payload,
                status: e.status,
                attempt_count: e.attempt_count,
                x_post_id: e.x_post_id,
                effect_created_at:
                  e.created_at ?? "2026-07-28T00:00:00.000Z",
              },
            ],
            error: null,
          };
        }

        if (fn === "complete_x_perception_effect") {
          const e = store.find((row) => row.id === args?.p_effect_id);
          if (!e || e.status !== "processing") return { data: false, error: null };
          e.status = "completed";
          e.external_result_id = args?.p_external_result_id;
          e.completed_at = new Date().toISOString();
          return { data: true, error: null };
        }

        if (fn === "fail_x_perception_effect") {
          const e = store.find((row) => row.id === args?.p_effect_id);
          if (!e || e.status !== "processing") return { data: false, error: null };
          e.status = "failed";
          e.failure_class = args?.p_failure_class;
          e.last_error = args?.p_last_error;
          return { data: true, error: null };
        }

        throw new Error(`unexpected rpc ${fn}`);
      },
    };

    return {
      admin,
      bumpX: () => {
        xCalls += 1;
      },
      bumpWall: (body: string) => {
        wallCalls += 1;
        wallBodies.push(body);
      },
      wallBodies,
    };
  }

  it("executes reply happy path once; completed effects are not reclaimed", async () => {
    const { admin, bumpX } = makeAdmin([
      {
        id: "e-reply",
        authorization_id: "a1",
        perception_event_id: "p1",
        effect_type: "reply_on_x",
        idempotency_key: `${POST_ID}:reply`,
        payload: { replyToXPostId: POST_ID, text: "ok" },
        status: "pending",
        attempt_count: 0,
        x_post_id: POST_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const first = await executeOneXPerceptionEffect(
      {},
      {
        admin,
        createReply: async () => {
          bumpX();
          return { ok: true, tweetId: "tw1" };
        },
      },
    );
    assert.equal(first.status, "completed");
    assert.equal(first.externalResultId, "tw1");
    assert.equal(admin.xCalls(), 1);

    const second = await executeOneXPerceptionEffect(
      {},
      {
        admin,
        createReply: async () => {
          bumpX();
          return { ok: true, tweetId: "tw2" };
        },
      },
    );
    assert.equal(second.status, "empty");
    assert.equal(admin.xCalls(), 1);
  });

  it("executes Wall with ASCII preserved and x_agent provenance", async () => {
    const { admin, bumpWall, wallBodies } = makeAdmin([
      {
        id: "e-wall",
        authorization_id: "a1",
        perception_event_id: "p1",
        effect_type: "write_to_wall",
        idempotency_key: stage12WallSourceExternalId(POST_ID),
        payload: {
          body: TREE_ASCII,
          sourceType: "x_agent",
          sourceExternalId: stage12WallSourceExternalId(POST_ID),
        },
        status: "pending",
        attempt_count: 0,
        x_post_id: POST_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const result = await executeOneXPerceptionEffect(
      {},
      {
        admin,
        writeWall: async (input) => {
          bumpWall(input.body);
          assert.equal(input.sourceType, "x_agent");
          assert.equal(
            input.sourceExternalId,
            stage12WallSourceExternalId(POST_ID),
          );
          return {
            created: true,
            entry: {
              id: "wall-1",
              body: input.body,
              createdAt: "2026-01-01T00:00:00Z",
              markCount: 0,
            },
          };
        },
      },
    );
    assert.equal(result.status, "completed");
    assert.equal(wallBodies[0], TREE_ASCII);
  });

  it("keeps reply completed when Wall fails; retries only Wall", async () => {
    const { admin, bumpX, bumpWall } = makeAdmin([
      {
        id: "e-reply",
        authorization_id: "a1",
        perception_event_id: "p1",
        effect_type: "reply_on_x",
        idempotency_key: `${POST_ID}:reply`,
        payload: { replyToXPostId: POST_ID, text: "ok" },
        status: "pending",
        attempt_count: 0,
        x_post_id: POST_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "e-wall",
        authorization_id: "a1",
        perception_event_id: "p1",
        effect_type: "write_to_wall",
        idempotency_key: stage12WallSourceExternalId(POST_ID),
        payload: {
          body: "carve",
          sourceType: "x_agent",
          sourceExternalId: stage12WallSourceExternalId(POST_ID),
        },
        status: "pending",
        attempt_count: 0,
        x_post_id: POST_ID,
        created_at: "2026-01-01T00:00:01Z",
      },
    ]);

    const reply = await executeOneXPerceptionEffect(
      {},
      {
        admin,
        createReply: async () => {
          bumpX();
          return { ok: true, tweetId: "tw1" };
        },
      },
    );
    assert.equal(reply.status, "completed");

    const wallFail = await executeOneXPerceptionEffect(
      {},
      {
        admin,
        writeWall: async () => {
          bumpWall("carve");
          throw new WallError("wall_write_failed", "db down", 500);
        },
      },
    );
    assert.equal(wallFail.status, "failed");
    assert.equal(wallFail.failureClass, "retryable");

    // Mark wall retryable failed already; retry should only hit wall.
    const wallRetry = await executeOneXPerceptionEffect(
      {},
      {
        admin,
        createReply: async () => {
          bumpX();
          return { ok: true, tweetId: "tw-should-not" };
        },
        writeWall: async () => {
          bumpWall("carve");
          return {
            created: true,
            entry: {
              id: "wall-2",
              body: "carve",
              createdAt: "2026-01-01T00:00:00Z",
              markCount: 0,
            },
          };
        },
      },
    );
    assert.equal(wallRetry.status, "completed");
    assert.equal(admin.xCalls(), 1);
    assert.equal(admin.wallCalls(), 2);
  });

  it("keeps wall completed when reply fails; retries only reply", async () => {
    // Wall listed first so claim order can complete Wall while reply is still pending/failed.
    const { admin, bumpX, bumpWall } = makeAdmin([
      {
        id: "e-wall",
        authorization_id: "a1",
        perception_event_id: "p1",
        effect_type: "write_to_wall",
        idempotency_key: stage12WallSourceExternalId(POST_ID),
        payload: {
          body: "carve",
          sourceType: "x_agent",
          sourceExternalId: stage12WallSourceExternalId(POST_ID),
        },
        status: "pending",
        attempt_count: 0,
        x_post_id: POST_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "e-reply",
        authorization_id: "a1",
        perception_event_id: "p1",
        effect_type: "reply_on_x",
        idempotency_key: `${POST_ID}:reply`,
        payload: { replyToXPostId: POST_ID, text: "ok" },
        status: "pending",
        attempt_count: 0,
        x_post_id: POST_ID,
        created_at: "2026-01-01T00:00:01Z",
      },
    ]);

    const wallOk = await executeOneXPerceptionEffect(
      {},
      {
        admin,
        writeWall: async () => {
          bumpWall("carve");
          return {
            created: true,
            entry: {
              id: "wall-1",
              body: "carve",
              createdAt: "2026-01-01T00:00:00Z",
              markCount: 0,
            },
          };
        },
      },
    );
    assert.equal(wallOk.status, "completed");
    assert.equal(admin.wallCalls(), 1);

    const replyFail = await executeOneXPerceptionEffect(
      {},
      {
        admin,
        createReply: async () => {
          bumpX();
          return {
            ok: false as const,
            class: "retryable" as const,
            code: "x_rate_limited",
            message: "rate limited",
          };
        },
      },
    );
    assert.equal(replyFail.status, "failed");
    assert.equal(replyFail.failureClass, "retryable");

    const replyRetry = await executeOneXPerceptionEffect(
      {},
      {
        admin,
        createReply: async () => {
          bumpX();
          return { ok: true, tweetId: "tw-retry" };
        },
        writeWall: async () => {
          bumpWall("should-not");
          return {
            created: true,
            entry: {
              id: "wall-x",
              body: "no",
              createdAt: "2026-01-01T00:00:00Z",
              markCount: 0,
            },
          };
        },
      },
    );
    assert.equal(replyRetry.status, "completed");
    assert.equal(replyRetry.externalResultId, "tw-retry");
    assert.equal(admin.xCalls(), 2);
    assert.equal(admin.wallCalls(), 1);
  });

  it("dry-run does not claim or execute", async () => {
    const { admin, bumpX } = makeAdmin([
      {
        id: "e-reply",
        authorization_id: "a1",
        perception_event_id: "p1",
        effect_type: "reply_on_x",
        idempotency_key: `${POST_ID}:reply`,
        payload: { replyToXPostId: POST_ID, text: "ok" },
        status: "pending",
        attempt_count: 0,
        x_post_id: POST_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const dry = await executePendingXPerceptionEffects(
      { dryRun: true, limit: 1 },
      {
        admin,
        createReply: async () => {
          bumpX();
          return { ok: true, tweetId: "nope" };
        },
      },
    );
    assert.equal(dry.dryRun, 1);
    assert.equal(dry.completed, 0);
    assert.equal(admin.xCalls(), 0);
    assert.equal(admin.store[0]?.status, "pending");
    assert.match(formatExecuteBatchReport(dry), /^X effect execution\n/);
  });

  it("fails closed on tampered reply target without posting", async () => {
    const { admin, bumpX } = makeAdmin([
      {
        id: "e-reply",
        authorization_id: "a1",
        perception_event_id: "p1",
        effect_type: "reply_on_x",
        idempotency_key: `${POST_ID}:reply`,
        payload: { replyToXPostId: "111", text: "hijack" },
        status: "pending",
        attempt_count: 0,
        x_post_id: POST_ID,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const result = await executeOneXPerceptionEffect(
      {},
      {
        admin,
        createReply: async () => {
          bumpX();
          return { ok: true, tweetId: "bad" };
        },
      },
    );
    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, "terminal");
    assert.equal(admin.xCalls(), 0);
  });
});

describe("Stage 12.6 architecture", () => {
  it("migration and routes lock OAuth + effect execution", () => {
    const migration = join(
      repo,
      "supabase/migrations/20260728120000_29_stage126_x_effects_execution.sql",
    );
    assert.ok(existsSync(migration));
    const sql = readFileSync(migration, "utf8");
    assert.match(sql, /x_oauth_credentials/);
    assert.match(sql, /claim_x_perception_effect/);
    assert.match(sql, /failure_class/);
    assert.match(sql, /REVOKE ALL ON TABLE public\.x_oauth_credentials/);

    assert.ok(
      existsSync(join(repo, "src/app/api/admin/x/oauth/start/route.ts")),
    );
    assert.ok(existsSync(join(repo, "src/app/api/auth/x/callback/route.ts")));

    for (const rel of [
      "src/lib/agent/stage126-execute.ts",
      "src/lib/x/write-client.ts",
    ]) {
      const source = readFileSync(join(repo, rel), "utf8");
      assert.doesNotMatch(source, /getOpenAIClient|\bopenai\b/, rel);
      assert.doesNotMatch(source, /safeRetrievePublicAgentKnowledge/, rel);
      assert.doesNotMatch(source, /executeStage124LiveReads/, rel);
      assert.doesNotMatch(source, /awardLeaf|signTransaction/, rel);
    }
  });

  it("package script exists", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["agent:execute-x"] ?? "", /agent-execute-x/);
  });
});
