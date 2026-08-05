import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CLEARING_PUBLIC_POLL_MS,
  CLEARING_MAX_REQUEST_BODY_BYTES,
  CLEARING_RATE_LIMITS,
  CLEARING_TRAVELLER_MESSAGE_LIMIT,
} from "@/lib/clearing/config";
import {
  generateTravellerId,
  openTravellerCookie,
  resolveClearingCookieSecret,
  sealTravellerCookie,
} from "@/lib/clearing/cookie";
import { ClearingError } from "@/lib/clearing/errors";
import { logClearing } from "@/lib/clearing/log";
import { validateClearingMessageBody } from "@/lib/clearing/dto";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Clearing 1.0D cookie secret policy", () => {
  it("production requires dedicated secret of 32+ chars", () => {
    assert.throws(
      () =>
        resolveClearingCookieSecret({
          NODE_ENV: "production",
          FENN_CLEARING_COOKIE_SECRET: "tooshort",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-key-long-enough!!",
        }),
      (e: unknown) => e instanceof ClearingError && e.code === "clearing_config",
    );
    assert.throws(
      () =>
        resolveClearingCookieSecret({
          NODE_ENV: "production",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-key-long-enough!!",
        }),
      (e: unknown) => e instanceof ClearingError,
    );
    const ok = resolveClearingCookieSecret({
      NODE_ENV: "production",
      FENN_CLEARING_COOKIE_SECRET: "x".repeat(32),
    });
    assert.equal(ok.length, 32);
  });

  it("development may fall back to service role when no dedicated secret", () => {
    const s = resolveClearingCookieSecret({
      NODE_ENV: "development",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-long-enough!!",
    });
    assert.match(s, /service-role/);
  });
});

describe("Clearing 1.0D request/payload hardening", () => {
  it("defines bounded body and poll cadence", () => {
    assert.ok(CLEARING_MAX_REQUEST_BODY_BYTES <= 16_384);
    assert.equal(CLEARING_PUBLIC_POLL_MS, 5_000);
    assert.ok(CLEARING_RATE_LIMITS.networkMintPerWindow <= 20);
  });

  it("request helper rejects oversized content-type/body (source)", () => {
    const req = read("src/lib/clearing/request.ts");
    assert.match(req, /application\/json/);
    assert.match(req, /clearing_payload_too_large/);
    assert.match(req, /413/);
  });

  it("strips control chars from bodies", () => {
    assert.equal(validateClearingMessageBody("hi\u0001there"), "hithere");
  });
});

describe("Clearing 1.0D rate limit atomicity", () => {
  it("migration provides consume_clearing_rate_bucket", () => {
    const mig = read(
      "supabase/migrations/20260805120000_49_clearing_hardening.sql",
    );
    assert.match(mig, /consume_clearing_rate_bucket/);
    assert.match(mig, /ON CONFLICT \(bucket_key\) DO UPDATE/);
    assert.match(mig, /status IN \('published', 'hidden'\)/);
    assert.match(mig, /FOR UPDATE/);
    assert.match(mig, /GRANT EXECUTE.*service_role/s);
  });

  it("rate-limit TS uses RPC and fails closed", () => {
    const rl = read("src/lib/clearing/rate-limit.ts");
    assert.match(rl, /consume_clearing_rate_bucket/);
    assert.match(rl, /503/);
    assert.doesNotMatch(rl, /hit_count \+ 1.*update/);
  });
});

describe("Clearing 1.0D three-cap & idempotency", () => {
  it("post accepts Outlaws only; traveller speak path is retired", () => {
    const post = read("src/lib/clearing/post.ts");
    const body = post.slice(post.indexOf("export async function postClearingMessage"));
    assert.ok(
      body.indexOf("findExistingByClientRequest") < body.indexOf("consumeRateBucket"),
    );
    assert.match(post, /outlaw_only|Only Outlaws may speak/);
    assert.doesNotMatch(post, /countAcceptedTravellerMessages/);
    assert.equal(CLEARING_TRAVELLER_MESSAGE_LIMIT, 3);
  });

  it("accepted count includes hidden for allowance", () => {
    const mod = read("src/lib/clearing/moderation.ts");
    assert.match(mod, /status", \["published", "hidden"\]/);
  });
});

describe("Clearing 1.0D logging safety", () => {
  it("logger omits bodies cookies and full IPs", () => {
    const log = read("src/lib/clearing/log.ts");
    assert.match(log, /domain: "clearing"/);
    assert.doesNotMatch(log, /cookieValue|Authorization|walletAddress/);
    // ensure helper doesn't accept arbitrary dump
    logClearing({ event: "message_accepted", ok: true, messageId: "x" });
  });
});

describe("Clearing 1.0D ops artifacts", () => {
  it("verify SQL and runbook exist", () => {
    const verify = read("supabase/verify_clearing_foundation.sql");
    assert.match(verify, /clearing_moderation_log/);
    assert.match(verify, /consume_clearing_rate_bucket/);
    assert.match(verify, /D_NO_ANON_MESSAGE_SELECT/);
    const runbook = read("docs/clearing-launch-runbook.md");
    assert.match(runbook, /FENN_CLEARING_COOKIE_SECRET/);
    assert.match(runbook, /CLOSE THE CLEARING|read-only/i);
    assert.match(runbook, /5 second/i);
    const abuse = read("docs/clearing-abuse.md");
    assert.match(abuse, /VPN|mint/i);
  });

  it("health is desk-only", () => {
    const health = read("src/lib/clearing/health.ts");
    assert.match(health, /cookieSecretConfigured/);
    const route = read("src/app/api/desk/clearing/route.ts");
    assert.match(route, /getClearingHealth/);
    assert.match(route, /requireFennDeskAccess/);
  });

  it("public UI uses 5s poll and no dangerouslySetInnerHTML", () => {
    const page = read("src/components/clearing/clearing-page.tsx");
    assert.match(page, /CLEARING_PUBLIC_POLL_MS|5000/);
    assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
    const msg = read("src/components/clearing/clearing-message-item.tsx");
    assert.doesNotMatch(msg, /dangerouslySetInnerHTML/);
  });

  it("env example documents cookie secret", () => {
    const env = read(".env.example");
    assert.match(env, /FENN_CLEARING_COOKIE_SECRET/);
  });
});

describe("Clearing concurrency SQL order", () => {
  it("locks then counts then inserts for travellers", () => {
    const mig = read(
      "supabase/migrations/20260805120000_49_clearing_hardening.sql",
    );
    const fn = mig.slice(mig.indexOf("post_clearing_message"));
    assert.ok(fn.indexOf("FOR UPDATE") < fn.indexOf("v_count >= 3"));
    assert.ok(
      fn.indexOf("v_count >= 3") < fn.indexOf("INSERT INTO public.clearing_messages"),
    );
  });
});

describe("Clearing cookie long payload rejection", () => {
  it("rejects absurd cookie length", () => {
    const id = generateTravellerId();
    const sealed = sealTravellerCookie(id, {
      secret: "dev-secret-sixteen!!",
    });
    assert.equal(
      openTravellerCookie(sealed + "x".repeat(1000), {
        secret: "dev-secret-sixteen!!",
      }),
      null,
    );
  });
});
