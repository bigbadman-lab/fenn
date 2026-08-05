import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { SafeClearingMessage } from "@/lib/clearing/dto";
import {
  filterFeedItems,
  filterMessageItems,
  findNewMessages,
  isClearingMessageItem,
  mergeConversationMessages,
  newestFirstToConversation,
} from "@/lib/clearing/feed-client";
import {
  CLEARING_PATH,
  CLEARING_REGISTER_HREF,
  isClearingRegisterOrigin,
} from "@/lib/clearing/origin";
import {
  formatClearingAbsoluteTime,
  formatClearingRelativeTime,
} from "@/lib/clearing/relative-time";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function msg(
  id: string,
  at: string,
  label = "Traveller Ash",
): SafeClearingMessage {
  return {
    kind: "message",
    id,
    occurredAt: at,
    author: { type: "traveller", label },
    body: `body-${id}`,
  };
}

describe("Clearing 1.0B route and orientation", () => {
  it("exposes /camp/clearing with THE CLEARING title", () => {
    const page = read("src/app/camp/clearing/page.tsx");
    assert.match(page, /title:\s*"THE CLEARING"/);
    assert.match(page, /path:\s*"\/camp\/clearing"/);
    assert.match(page, /ClearingPage/);
  });

  it("page carries core law copy and no automatic LEAF", () => {
    const ui = read("src/components/clearing/clearing-page.tsx");
    assert.match(ui, /The trees thin here/);
    assert.match(ui, /Anyone may listen/);
    assert.match(ui, /Only Outlaws may speak/);
    assert.match(ui, /group chat in the wood|Telegram/);
    assert.match(ui, /Nothing spoken here earns LEAF automatically/);
    assert.doesNotMatch(ui, /Travellers may speak three times/);
    assert.doesNotMatch(ui, /earn LEAF|awarded LEAF|LEAF for speaking/i);
  });

  it("Camp links to The Clearing without redesigning chat roster", () => {
    const camp = read("src/components/camp/camp-ground.tsx");
    assert.match(camp, /href="\/camp\/clearing"/);
    assert.match(camp, /GO TO THE CLEARING/);
    assert.match(camp, /Only Outlaws may speak/);
    assert.match(camp, /No LEAF is awarded automatically here/);
    assert.match(camp, /FENN, WREN, ROOK/);
  });
});

describe("Clearing feed merge and order", () => {
  it("reverses newest-first API pages for conversation order", () => {
    const a = msg("a", "2026-08-05T10:00:00.000Z");
    const b = msg("b", "2026-08-05T11:00:00.000Z");
    // API returns newest first
    const chronological = newestFirstToConversation([b, a]);
    assert.equal(chronological[0]?.id, "a");
    assert.equal(chronological[1]?.id, "b");
  });

  it("dedupes by id and merges polls stably", () => {
    const a = msg("a", "2026-08-05T10:00:00.000Z");
    const b = msg("b", "2026-08-05T11:00:00.000Z");
    const c = msg("c", "2026-08-05T12:00:00.000Z");
    const merged = mergeConversationMessages([a, b], [b, c]);
    assert.deepEqual(
      merged.map((m) => m.id),
      ["a", "b", "c"],
    );
    assert.deepEqual(
      findNewMessages([a, b], [b, c]).map((m) => m.id),
      ["c"],
    );
  });

  it("accepts market_watch and ignores unknown future feed kinds", () => {
    const items = filterFeedItems([
      msg("a", "2026-08-05T10:00:00.000Z"),
      {
        kind: "market_watch",
        id: "mw-1",
        occurredAt: "2026-08-05T11:00:00.000Z",
        amountLabel: "1 $FENN",
        transactionUrl: null,
      },
      { kind: "notice", id: "n-1" },
      { foo: 1 },
    ]);
    assert.equal(items.length, 2);
    assert.equal(items[1]?.kind, "market_watch");
    assert.equal(isClearingMessageItem({ kind: "market_watch" }), false);
  });
});

describe("Clearing relative time", () => {
  it("uses coarse buckets without seconds noise", () => {
    const now = Date.parse("2026-08-05T12:00:00.000Z");
    assert.equal(
      formatClearingRelativeTime("2026-08-05T11:59:40.000Z", now),
      "now",
    );
    assert.equal(
      formatClearingRelativeTime("2026-08-05T11:55:00.000Z", now),
      "5m",
    );
    assert.equal(
      formatClearingRelativeTime("2026-08-05T10:00:00.000Z", now),
      "2h",
    );
    assert.match(formatClearingAbsoluteTime("2026-08-05T10:00:00.000Z"), /UTC/);
  });
});

describe("Clearing outlaw-only speak gate", () => {
  it("composer does not offer traveller mint or guest draft", () => {
    const composer = read("src/components/clearing/clearing-composer.tsx");
    assert.match(composer, /outlaw_required|ONLY OUTLAWS MAY SPEAK/);
    assert.doesNotMatch(composer, /onEnsureTraveller|kind: "guest"|kind: "traveller"/);
    assert.match(composer, /BECOME AN OUTLAW|CLAIM A NAME/);
  });
});

describe("Clearing registration origin safety", () => {
  it("only accepts from=clearing to a fixed path", () => {
    assert.equal(isClearingRegisterOrigin("clearing"), true);
    assert.equal(isClearingRegisterOrigin("https://evil"), false);
    assert.equal(isClearingRegisterOrigin("//evil"), false);
    assert.equal(CLEARING_PATH, "/camp/clearing");
    assert.equal(CLEARING_REGISTER_HREF, "/outlaw/register?from=clearing");
  });
});

describe("Clearing composer and feed UI sources", () => {
  it("posts clientRequestId and never trusts client author fields", () => {
    const composer = read("src/components/clearing/clearing-composer.tsx");
    assert.match(composer, /clientRequestId/);
    assert.match(composer, /\/api\/clearing\/messages/);
    assert.doesNotMatch(composer, /author_type|profileId|displayName:\s*input/);
    assert.match(composer, /BECOME AN OUTLAW|CLAIM A NAME/);
    assert.match(composer, /clearing_registration_required|outlaw_required/);
  });

  it("polls with visibility awareness and no full-feed aria-live", () => {
    const page = read("src/components/clearing/clearing-page.tsx");
    assert.match(page, /visibilitychange|visibilityState/);
    assert.match(page, /POLL_MS|CLEARING_PUBLIC_POLL_MS|5000/);
    assert.match(page, /NEW IN THE CLEARING/);
    assert.match(page, /LOAD OLDER/);
    assert.match(page, /role="log"/);
    assert.doesNotMatch(page, /aria-live=\{?["']polite["']\}?.*feed|feed.*aria-live/);
    // feed region itself must not be aria-live
    assert.doesNotMatch(
      page,
      /className="clearing__feed"[\s\S]{0,80}aria-live/,
    );
  });

  it("keeps feed/composer item boundary for known kinds", () => {
    const item = read("src/components/clearing/clearing-feed-item.tsx");
    assert.match(item, /isClearingMessageItem/);
    assert.match(item, /ClearingMessageItem/);
    assert.match(item, /isMarketWatchFeedItem|MarketWatchFeedItem/);
  });

  it("exposes muted/banned/read-only composer states", () => {
    const composer = read("src/components/clearing/clearing-composer.tsx");
    assert.match(composer, /THE CLEARING IS LISTENING/);
    assert.match(composer, /DOES NOT HEAR YOU JUST NOW/);
    assert.match(composer, /ROAD IS CLOSED TO YOUR VOICE/);
    assert.match(composer, /ROAD ASKS FOR PATIENCE/);
    assert.match(composer, /Ctrl|metaKey|cmd/);
  });

  it("feed API returns public state for read-only UI", () => {
    const route = read("src/app/api/clearing/feed/route.ts");
    assert.match(route, /state/);
    const feed = read("src/lib/clearing/feed.ts");
    assert.match(feed, /readOnly/);
    assert.match(feed, /slowModeSeconds/);
  });

  it("outlaw page can return to Clearing from safe origin", () => {
    const outlaw = read("src/app/outlaw/page.tsx");
    assert.match(outlaw, /RETURN TO THE CLEARING/);
    assert.match(outlaw, /peekClearingRegistrationOrigin/);
    const reg = read("src/components/outlaw/outlaw-register-panel.tsx");
    assert.match(reg, /markClearingRegistrationOrigin/);
    assert.match(reg, /isClearingRegisterOrigin/);
  });

  it("does not use Supabase from browser components", () => {
    for (const rel of [
      "src/components/clearing/clearing-page.tsx",
      "src/components/clearing/clearing-composer.tsx",
      "src/components/clearing/clearing-message-item.tsx",
      "src/components/clearing/market-watch-feed-item.tsx",
    ]) {
      const src = read(rel);
      assert.doesNotMatch(src, /createClient|supabase|from\("clearing/i);
    }
  });
});
