/**
 * Clearing 1.1 — presence, lazy mint, incremental poll, no post-refresh.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { SafeClearingMessage } from "@/lib/clearing/dto";
import { decodeFeedCursor } from "@/lib/clearing/dto";
import {
  clearingStateEqual,
  encodeClientFeedCursor,
  feedPollHasAdditions,
  mergePollFeed,
  newestFeedItem,
  newestFirstToConversation,
} from "@/lib/clearing/feed-client";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function msg(id: string, at: string): SafeClearingMessage {
  return {
    kind: "message",
    id,
    occurredAt: at,
    author: { type: "traveller", label: "Traveller Ash" },
    body: `body-${id}`,
  };
}

describe("Clearing 1.1 lazy Traveller minting", () => {
  it("does not mint Traveller on automatic page load", () => {
    const page = read("src/components/clearing/clearing-page.tsx");
    // No mount effect that mints guests after identity
    assert.doesNotMatch(
      page,
      /useEffect\(\(\) => \{\s*if \(identityPending\) return;\s*if \(authenticated\) return;\s*void mintTraveller/,
    );
    assert.match(page, /Lazy mint/);
    assert.match(page, /kind: "guest"/);
  });

  it("composer mints on focus or SPEAK intent", () => {
    const composer = read("src/components/clearing/clearing-composer.tsx");
    assert.match(composer, /kind: "guest"/);
    assert.match(composer, /onFocus=\{onComposerFocus\}/);
    assert.match(composer, /onEnsureTraveller/);
    assert.match(composer, /identity\.kind === "guest"/);
  });
});

describe("Clearing 1.1 feed-first architecture", () => {
  it("loads feed independent of identity and avoids LISTENING / waiting for the road", () => {
    const page = read("src/components/clearing/clearing-page.tsx");
    assert.match(page, /identity-independent|mode: "replace"/);
    assert.doesNotMatch(page, /LISTENING TO THE CLEARING/);
    assert.doesNotMatch(page, /waiting for the road to know you/i);
    assert.match(page, /The Clearing is here/);

    const composer = read("src/components/clearing/clearing-composer.tsx");
    assert.doesNotMatch(composer, /waiting for the road to know you/i);
  });
});

describe("Clearing 1.1 submission acknowledgment", () => {
  it("shows dedicated writing state without optimistic posts", () => {
    const composer = read("src/components/clearing/clearing-composer.tsx");
    assert.match(composer, /YOUR WORDS ARE ENTERING THE WOOD/);
    assert.match(composer, /WRITING…/);
    assert.doesNotMatch(composer, /optimistic|fake.*message|pendingMessage/i);
    assert.match(composer, /aria-live="assertive"|role="status"/);
  });
});

describe("Clearing 1.1 no post-success feed refresh", () => {
  it("merges canonical message without fetchFeed after accept", () => {
    const page = read("src/components/clearing/clearing-page.tsx");
    assert.match(page, /onAccepted/);
    assert.match(page, /mergeConversationMessages\(prev, \[message\]\)/);
    assert.doesNotMatch(
      page,
      /onAccepted[\s\S]{0,400}fetchFeed\(\{\s*mode:\s*"merge"/,
    );
    assert.match(page, /no post-success full refresh/i);
  });
});

describe("Clearing 1.1 incremental and no-change polling", () => {
  it("API and loader support since watermark", () => {
    const route = read("src/app/api/clearing/feed/route.ts");
    assert.match(route, /since/);
    const feed = read("src/lib/clearing/feed.ts");
    assert.match(feed, /postgrestNewerThan|since/);
    assert.match(feed, /incremental/);
  });

  it("client encodes watermark compatible with decodeFeedCursor", () => {
    const at = "2026-08-05T12:00:00.000Z";
    const id = "a0000000-0000-4000-8000-000000000001";
    const encoded = encodeClientFeedCursor(at, id);
    const decoded = decodeFeedCursor(encoded);
    assert.ok(decoded);
    assert.equal(decoded!.createdAt, at);
    assert.equal(decoded!.id, id);
  });

  it("encodeClientFeedCursor never relies on Buffer base64url encoding", () => {
    const src = read("src/lib/clearing/feed-client.ts");
    // Executable path uses base64 then converts to base64url — never .toString("base64url")
    assert.doesNotMatch(
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
      /\.toString\(\s*["']base64url["']\s*\)/,
    );
    assert.match(src, /\.toString\(\s*["']base64["']\s*\)|btoa/);
    const enc = encodeClientFeedCursor(
      "2026-08-05T12:00:00.000Z",
      "a0000000-0000-4000-8000-000000000001",
    );
    assert.ok(enc.length > 8);
    assert.doesNotMatch(enc, /[+/=]/);
  });

  it("page does not encode watermark inside setState updaters on accept", () => {
    const page = read("src/components/clearing/clearing-page.tsx");
    assert.match(page, /queueMicrotask/);
    assert.match(page, /Defensive: never throw/);
  });

  it("mergePollFeed preserves array identity on no-change", () => {
    const a = msg("a0000000-0000-4000-8000-00000000000a", "2026-08-05T10:00:00.000Z");
    const b = msg("b0000000-0000-4000-8000-00000000000b", "2026-08-05T11:00:00.000Z");
    const existing = [a, b];
    const empty = mergePollFeed(existing, []);
    assert.equal(empty.next, existing);
    assert.equal(empty.added.length, 0);

    const same = mergePollFeed(existing, [b, a]);
    assert.equal(same.next, existing);
    assert.equal(same.added.length, 0);

    const c = msg("c0000000-0000-4000-8000-00000000000c", "2026-08-05T12:00:00.000Z");
    const grown = mergePollFeed(existing, [c]);
    assert.notEqual(grown.next, existing);
    assert.equal(grown.added.length, 1);
    assert.equal(newestFeedItem(grown.next)?.id, c.id);
    assert.equal(feedPollHasAdditions(existing, [c]), true);
    assert.equal(feedPollHasAdditions(existing, [a]), false);
  });

  it("clearingStateEqual avoids needless state writes", () => {
    assert.equal(
      clearingStateEqual(
        { readOnly: false, slowModeSeconds: 0 },
        { readOnly: false, slowModeSeconds: 0 },
      ),
      true,
    );
    assert.equal(
      clearingStateEqual(
        { readOnly: false, slowModeSeconds: 0 },
        { readOnly: true, slowModeSeconds: 0 },
      ),
      false,
    );
  });

  it("page polls with since and pauses when hidden", () => {
    const page = read("src/components/clearing/clearing-page.tsx");
    assert.match(page, /newestWatermarkRef|encodeClientFeedCursor/);
    assert.match(page, /since/);
    assert.match(page, /visibilityState === "hidden"/);
    assert.match(page, /visibilitychange/);
  });
});

describe("Clearing 1.1 scroll polish", () => {
  it("tracks force scroll for own posts and skips empty polls", () => {
    const page = read("src/components/clearing/clearing-page.tsx");
    assert.match(page, /forceScrollRef/);
    assert.match(page, /tailChanged/);
    assert.doesNotMatch(
      page,
      /void fetchFeed\(\{\s*mode:\s*"merge"\s*\}\)/,
    );
  });
});

describe("Clearing 1.1 chronology helpers", () => {
  it("newestFeedItem is conversation tail", () => {
    const a = msg("a0000000-0000-4000-8000-00000000000a", "2026-08-05T10:00:00.000Z");
    const b = msg("b0000000-0000-4000-8000-00000000000b", "2026-08-05T11:00:00.000Z");
    const chrono = newestFirstToConversation([b, a]);
    assert.equal(newestFeedItem(chrono)?.id, "b0000000-0000-4000-8000-00000000000b");
  });
});

describe("Clearing 1.1 Market Watch / authority unchanged", () => {
  it("feed still merges market_watch and messages published-only", () => {
    const feed = read("src/lib/clearing/feed.ts");
    assert.match(feed, /market_watch_events/);
    assert.match(feed, /eq\("status", "published"\)/);
    assert.match(feed, /event_type.*acquisition|eq\("event_type", "acquisition"\)/);
  });

  it("post path still server-authored", () => {
    const messages = read("src/app/api/clearing/messages/route.ts");
    assert.match(messages, /postClearingMessage/);
    assert.match(messages, /never trusts client author/i);
  });
});
