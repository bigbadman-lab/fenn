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
import { createXReplyAsFenn } from "@/lib/x/write-client";
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
      redirectUri: "https://imfenn.com/api/auth/x/callback",
      state: pkce.state,
      codeChallenge: pkce.codeChallenge,
    });
    assert.match(url, /code_challenge_method=S256/);
    assert.match(url, /tweet\.write/);
    assert.match(url, /offline\.access/);
  });

  it("resolves redirect from site URL only", () => {
    assert.equal(
      resolveXOauthRedirectUri("https://imfenn.com/"),
      "https://imfenn.com/api/auth/x/callback",
    );
  });

  it("rejects wrong X account identity", () => {
    assert.throws(
      () =>
        assertFennXIdentity(
          { id: "1", username: "someone" },
          { fennXUserId: FENN_ID, fennXUsername: "askfenn" },
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
    process.env.FENN_X_USERNAME = "askfenn";
    process.env.NEXT_PUBLIC_SITE_URL = "https://imfenn.com";
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
          xUsername: "askfenn",
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
          xUsername: "askfenn",
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
          xUsername: "askfenn",
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
          xUsername: "askfenn",
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
          return {
            data: store
              .filter(
                (e) =>
                  e.status === "pending" ||
                  (e.status === "failed" && e.failure_class === "retryable"),
              )
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
              })),
            error: null,
          };
        }

        if (fn === "claim_x_perception_effect") {
          const xPostFilter =
            typeof args?.p_x_post_id === "string" ? args.p_x_post_id : null;
          const idx = store.findIndex((e) => {
            const executable =
              e.status === "pending" ||
              (e.status === "failed" && e.failure_class === "retryable");
            if (!executable) return false;
            if (xPostFilter && e.x_post_id !== xPostFilter) return false;
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
