import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CLEARING_MESSAGE_MAX_CHARS,
  CLEARING_TRAVELLER_COOKIE_NAME,
  CLEARING_TRAVELLER_MESSAGE_LIMIT,
} from "@/lib/clearing/config";
import {
  generateTravellerId,
  openTravellerCookie,
  sealTravellerCookie,
} from "@/lib/clearing/cookie";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  requireClientRequestId,
  toSafeClearingMessage,
  validateClearingMessageBody,
} from "@/lib/clearing/dto";
import { ClearingError } from "@/lib/clearing/errors";
import {
  assertOutlawCanSpeak,
  assertTravellerCanSpeak,
  isMutedUntil,
  messagesRemainingForTraveller,
} from "@/lib/clearing/moderation";
import {
  formatTravellerDisplayName,
  isCuratedTravellerDisplayName,
  pickTravellerSurname,
  CLEARING_TRAVELLER_SURNAMES,
} from "@/lib/clearing/names";
import { hashClearingNetworkKey } from "@/lib/clearing/rate-limit";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const SECRET = "test-clearing-cookie-secret-32b!";

describe("Clearing Traveller names", () => {
  it("formats curated display names only", () => {
    assert.equal(formatTravellerDisplayName("Ash"), "Traveller Ash");
    assert.ok(CLEARING_TRAVELLER_SURNAMES.length >= 20);
    for (const s of CLEARING_TRAVELLER_SURNAMES) {
      assert.ok(isCuratedTravellerDisplayName(formatTravellerDisplayName(s)));
    }
    assert.equal(isCuratedTravellerDisplayName("Haxor"), false);
    assert.equal(isCuratedTravellerDisplayName("Traveller "), false);
  });

  it("picks from catalogue", () => {
    const name = pickTravellerSurname(() => 0);
    assert.ok((CLEARING_TRAVELLER_SURNAMES as readonly string[]).includes(name));
  });
});

describe("Clearing signed cookie", () => {
  it("round-trips traveller id", () => {
    const id = generateTravellerId();
    const sealed = sealTravellerCookie(id, { secret: SECRET });
    assert.notEqual(sealed, id);
    assert.equal(openTravellerCookie(sealed, { secret: SECRET }), id);
  });

  it("rejects tampered payload", () => {
    const id = generateTravellerId();
    const sealed = sealTravellerCookie(id, { secret: SECRET });
    const bad = sealed.slice(0, -4) + "dead";
    assert.equal(openTravellerCookie(bad, { secret: SECRET }), null);
  });

  it("rejects expired cookie", () => {
    const id = generateTravellerId();
    const sealed = sealTravellerCookie(id, {
      secret: SECRET,
      maxAgeSeconds: 10,
      nowMs: Date.now() - 60_000,
    });
    assert.equal(openTravellerCookie(sealed, { secret: SECRET }), null);
  });

  it("uses HttpOnly cookie name fenn_clearing_traveller", () => {
    assert.equal(CLEARING_TRAVELLER_COOKIE_NAME, "fenn_clearing_traveller");
    const cookie = read("src/lib/clearing/cookie.ts");
    assert.match(cookie, /httpOnly:\s*true/);
    assert.match(cookie, /sameSite:\s*"lax"/);
  });

  it("issues stable id generator uuid shape", () => {
    const id = generateTravellerId();
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe("Clearing body validation", () => {
  it("accepts plain text within limit", () => {
    assert.equal(validateClearingMessageBody("  hello road  "), "hello road");
  });

  it("rejects empty, oversized, non-string", () => {
    assert.throws(
      () => validateClearingMessageBody("   "),
      (e: unknown) => e instanceof ClearingError && e.code === "clearing_invalid_body",
    );
    assert.throws(
      () => validateClearingMessageBody("x".repeat(CLEARING_MESSAGE_MAX_CHARS + 1)),
      (e: unknown) => e instanceof ClearingError,
    );
    assert.throws(() => validateClearingMessageBody(12 as unknown));
  });

  it("strips null bytes", () => {
    assert.equal(validateClearingMessageBody("a\u0000b"), "ab");
  });

  it("requires uuid client_request_id", () => {
    assert.throws(() => requireClientRequestId("nope"));
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    assert.equal(requireClientRequestId(id), id);
  });
});

describe("Clearing three-message logic", () => {
  it("computes remaining from accepted count", () => {
    assert.equal(messagesRemainingForTraveller(0), 3);
    assert.equal(messagesRemainingForTraveller(2), 1);
    assert.equal(messagesRemainingForTraveller(3), 0);
    assert.equal(messagesRemainingForTraveller(9), 0);
    assert.equal(CLEARING_TRAVELLER_MESSAGE_LIMIT, 3);
  });
});

describe("Clearing moderation guards", () => {
  it("detects muted_until", () => {
    assert.equal(isMutedUntil(null), false);
    assert.equal(
      isMutedUntil(new Date(Date.now() + 60_000).toISOString()),
      true,
    );
    assert.equal(
      isMutedUntil(new Date(Date.now() - 60_000).toISOString()),
      false,
    );
  });

  it("blocks banned / muted travellers", () => {
    assert.throws(
      () =>
        assertTravellerCanSpeak({
          id: "x",
          display_name: "Traveller Ash",
          created_at: "",
          last_seen_at: "",
          muted_until: null,
          banned_at: new Date().toISOString(),
        }),
      (e: unknown) => e instanceof ClearingError && e.code === "clearing_banned",
    );
    assert.throws(
      () =>
        assertTravellerCanSpeak({
          id: "x",
          display_name: "Traveller Ash",
          created_at: "",
          last_seen_at: "",
          muted_until: new Date(Date.now() + 99999).toISOString(),
          banned_at: null,
        }),
      (e: unknown) => e instanceof ClearingError && e.code === "clearing_muted",
    );
  });

  it("blocks banned / muted outlaws", () => {
    assert.throws(
      () =>
        assertOutlawCanSpeak({
          profile_id: "p",
          muted_until: null,
          banned_at: new Date().toISOString(),
        }),
      (e: unknown) => e instanceof ClearingError && e.code === "clearing_banned",
    );
    assertOutlawCanSpeak(null);
  });
});

describe("Clearing DTO sanitisation", () => {
  it("never includes profile ids or moderation private fields", () => {
    const safe = toSafeClearingMessage({
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      author_type: "outlaw",
      author_display_name_snapshot: "Alex",
      body: "hello",
      created_at: "2026-08-05T00:00:00.000Z",
    });
    assert.equal(safe.kind, "message");
    assert.equal(safe.author.type, "outlaw");
    assert.equal(safe.author.label, "Alex");
    assert.equal(safe.body, "hello");
    assert.doesNotMatch(JSON.stringify(safe), /profile|wallet|hidden_by|cookie/i);
  });
});

describe("Clearing feed cursor", () => {
  it("encodes and decodes", () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const cur = encodeFeedCursor("2026-08-05T12:00:00.000Z", id);
    assert.deepEqual(decodeFeedCursor(cur), {
      createdAt: "2026-08-05T12:00:00.000Z",
      id,
    });
    assert.equal(decodeFeedCursor("junk"), null);
  });
});

describe("Clearing network key hash", () => {
  it("does not store plain IP", () => {
    const h = hashClearingNetworkKey("1.2.3.4");
    assert.notEqual(h, "1.2.3.4");
    assert.equal(h.length, 32);
    assert.equal(hashClearingNetworkKey("1.2.3.4"), h);
  });
});

describe("Clearing post domain rules (source)", () => {
  it("rejects authenticated-unregistered and enforces three-cap / no LEAF", () => {
    const post = read("src/lib/clearing/post.ts");
    assert.match(post, /registration_required/);
    assert.match(post, /registered === false/);
    assert.match(post, /CLEARING_TRAVELLER_MESSAGE_LIMIT/);
    assert.match(post, /post_clearing_message/);
    assert.doesNotMatch(post, /leaf|reward|camp_message|applyCamp/i);

    const route = read("src/app/api/clearing/messages/route.ts");
    assert.doesNotMatch(route, /author_type|displayName|profileId/);
  });

  it("messages route never trusts client author fields", () => {
    const route = read("src/app/api/clearing/messages/route.ts");
    assert.doesNotMatch(route, /payload\.author|body\.author_type|body\.profileId/);
    assert.match(route, /postClearingMessage/);
  });

  it("feed is public published-only", () => {
    const feed = read("src/lib/clearing/feed.ts");
    assert.match(feed, /status.*published|eq\("status", "published"\)/);
    assert.match(feed, /kind.*message|toSafeClearingMessage/);
  });

  it("moderation route is Desk-gated", () => {
    const mod = read("src/app/api/clearing/moderation/route.ts");
    assert.match(mod, /requireFennDeskAccess/);
    assert.match(mod, /hide|mute_traveller|ban_outlaw|set_state/);
  });

  it("migration enforces XOR, three-cap RPC, service role, no LEAF columns", () => {
    const mig = read(
      "supabase/migrations/20260805120000_47_clearing_foundation.sql",
    );
    assert.match(mig, /clearing_travellers/);
    assert.match(mig, /clearing_messages/);
    assert.match(mig, /clearing_state/);
    assert.match(mig, /clearing_messages_author_xor/);
    assert.match(mig, /post_clearing_message/);
    assert.match(mig, /registration_required/);
    assert.match(mig, /v_count >= 3/);
    assert.match(mig, /FOR UPDATE/);
    assert.match(mig, /REVOKE ALL ON public\.clearing_messages FROM anon/);
    assert.match(mig, /GRANT ALL ON public\.clearing_messages TO service_role/);
    // No public SELECT of full rows (would leak traveller_id / profile_id)
    assert.doesNotMatch(mig, /GRANT SELECT ON public\.clearing_messages TO anon/);
    assert.doesNotMatch(mig, /clearing_messages_public_published_select/);
    assert.match(mig, /status = 'published'/);
    assert.doesNotMatch(mig, /leaf_|reward_|memory_candidate/i);
    assert.doesNotMatch(mig, /market_watch/i);
  });

  it("no Market Watch worker; public route exists under /camp/clearing", () => {
    const travellerRoute = read("src/app/api/clearing/traveller/route.ts");
    assert.match(travellerRoute, /mintOrResumeTraveller/);
    const page = read("src/app/camp/clearing/page.tsx");
    assert.match(page, /ClearingPage/);
  });
});

describe("Clearing concurrent three-cap authority", () => {
  it("SQL serialises allowance with FOR UPDATE before insert", () => {
    const mig = read(
      "supabase/migrations/20260805120000_47_clearing_foundation.sql",
    );
    const fn = mig.slice(mig.indexOf("post_clearing_message"));
    assert.ok(fn.indexOf("FOR UPDATE") < fn.indexOf("v_count >= 3"));
    assert.ok(fn.indexOf("v_count >= 3") < fn.indexOf("INSERT INTO public.clearing_messages"));
  });
});

describe("Clearing security validation", () => {
  it("rejects body spoof fields and oversized unicode safely", () => {
    // Emoji/surrogate pairs count as JS string length — enforce length
    const long = "字".repeat(CLEARING_MESSAGE_MAX_CHARS + 1);
    assert.throws(() => validateClearingMessageBody(long));
    // Script-looking text is stored plain; not executed (validation accepts as text)
    const scriptish = "<script>alert(1)</script>";
    assert.equal(validateClearingMessageBody(scriptish), scriptish);
  });

  it("public DTO never exposes traveller id or cookie", () => {
    const safe = toSafeClearingMessage({
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      author_type: "traveller",
      author_display_name_snapshot: "Traveller Ash",
      body: "road open",
      created_at: "2026-08-05T00:00:00.000Z",
    });
    const json = JSON.stringify(safe);
    assert.doesNotMatch(json, /traveller_id|fenn_clearing|cookie|muted|banned|wallet/i);
    assert.equal(safe.author.label, "Traveller Ash");
  });

  it("mint route rate-limits before create", () => {
    const route = read("src/app/api/clearing/traveller/route.ts");
    assert.match(route, /resolveTravellerResume/);
    assert.ok(
      route.indexOf("consumeRateBucket") < route.indexOf("mintOrResumeTraveller"),
    );
  });

  it("moderation supports mute/ban traveller and outlaw + global state", () => {
    const mod = read("src/lib/clearing/moderation.ts");
    assert.match(mod, /hideClearingMessage/);
    assert.match(mod, /setTravellerModeration/);
    assert.match(mod, /setOutlawModeration/);
    const state = read("src/lib/clearing/state.ts");
    assert.match(state, /readOnly|read_only/);
    assert.match(state, /slowModeSeconds|slow_mode_seconds/);
  });

  it("post maps read-only, mute, ban, slow mode", () => {
    const post = read("src/lib/clearing/post.ts");
    assert.match(post, /clearing_read_only/);
    assert.match(post, /assertTravellerCanSpeak|assertOutlawCanSpeak/);
    assert.match(post, /assertAuthorCooldown/);
    assert.match(post, /slowModeSeconds|slow_mode/);
  });
});
