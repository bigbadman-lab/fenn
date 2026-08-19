/**
 * Market Watch 1.0B — Clearing feed projection of published acquisitions.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type {
  SafeClearingMessage,
  SafeMarketWatchFeedItem,
} from "@/lib/clearing/dto";
import { mergeClearingFeedSources } from "@/lib/clearing/feed";
import {
  filterFeedItems,
  findNewMessages,
  isClearingFeedItem,
  isMarketWatchFeedItem,
  mergeConversationMessages,
  newestFirstToConversation,
} from "@/lib/clearing/feed-client";
import {
  CLEARING_WOOD_NOTICES_HEADING,
  formatClearingMarketFennAmount,
  formatTokenAmountWithSeparators,
  marketWatchExplorerUrl,
} from "@/lib/clearing/market-display";

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

function wood(
  id: string,
  at: string,
  amountLabel = "1,000 $VELL",
): SafeMarketWatchFeedItem {
  return {
    kind: "market_watch",
    id,
    occurredAt: at,
    amountLabel,
    transactionUrl: "https://robinhoodchain.blockscout.com/tx/0x" + "ab".repeat(32),
  };
}

describe("Market Watch 1.0B feed merge", () => {
  it("interleaves messages and acquisitions newest-first for API pages", () => {
    const messages = [
      msg("m2", "2026-08-05T12:00:00.000Z"),
      msg("m1", "2026-08-05T10:00:00.000Z"),
    ];
    const mw = [
      wood("w1", "2026-08-05T11:00:00.000Z", "11,400 $VELL"),
    ];
    const { items, hasMore } = mergeClearingFeedSources(messages, mw, 10);
    assert.equal(hasMore, false);
    assert.deepEqual(
      items.map((i) => i.id),
      ["m2", "w1", "m1"],
    );
    assert.equal(items[1]?.kind, "market_watch");
  });

  it("limits merged page and reports hasMore", () => {
    const messages = [
      msg("m3", "2026-08-05T13:00:00.000Z"),
      msg("m2", "2026-08-05T12:00:00.000Z"),
      msg("m1", "2026-08-05T10:00:00.000Z"),
    ];
    const mw = [wood("w1", "2026-08-05T11:00:00.000Z")];
    const { items, hasMore } = mergeClearingFeedSources(messages, mw, 2);
    assert.equal(hasMore, true);
    assert.equal(items.length, 2);
    assert.equal(items[0]?.id, "m3");
    assert.equal(items[1]?.id, "m2");
  });

  it("conversation merge dedupes mixed kinds by id", () => {
    const a = msg("a", "2026-08-05T10:00:00.000Z");
    const w = wood("w", "2026-08-05T10:30:00.000Z");
    const b = msg("b", "2026-08-05T11:00:00.000Z");
    const chron = newestFirstToConversation([b, w, a]);
    assert.equal(chron[0]?.id, "a");
    const merged = mergeConversationMessages([a, w], [w, b]);
    assert.deepEqual(
      merged.map((m) => m.id),
      ["a", "w", "b"],
    );
    assert.deepEqual(
      findNewMessages([a, w], [w, b]).map((m) => m.id),
      ["b"],
    );
  });
});

describe("Market Watch 1.0B public DTO gates", () => {
  it("accepts only published-shaped market_watch items", () => {
    assert.equal(
      isMarketWatchFeedItem({
        kind: "market_watch",
        id: "x",
        occurredAt: "2026-08-05T10:00:00.000Z",
        amountLabel: "2,340 $VELL",
        transactionUrl: null,
      }),
      true,
    );
    assert.equal(
      isMarketWatchFeedItem({ kind: "market_watch", id: "x" }),
      false,
    );
    assert.equal(isClearingFeedItem(msg("a", "2026-08-05T10:00:00.000Z")), true);
  });

  it("filterFeedItems keeps messages and market_watch, drops unknown", () => {
    const items = filterFeedItems([
      msg("a", "2026-08-05T10:00:00.000Z"),
      wood("w", "2026-08-05T11:00:00.000Z"),
      { kind: "notice", id: "n-1", occurredAt: "x" },
      { kind: "agent", id: "x" },
      { foo: 1 },
    ]);
    assert.equal(items.length, 2);
    assert.equal(items[0]?.kind, "message");
    assert.equal(items[1]?.kind, "market_watch");
  });
});

describe("Market Watch 1.0B amount + explorer formatting", () => {
  it("formats amounts with separators without float math", () => {
    assert.equal(formatTokenAmountWithSeparators("18420"), "18,420");
    assert.equal(formatTokenAmountWithSeparators("18420.5"), "18,420.5");
    assert.equal(formatTokenAmountWithSeparators("0.1000"), "0.1");
    const raw = BigInt(2340) * BigInt(10) ** BigInt(18);
    assert.equal(
      formatClearingMarketFennAmount(raw, 18, "VELL"),
      "2,340 $VELL",
    );
  });

  it("builds Robinhood explorer URLs only for valid hashes", () => {
    const hash = "0x" + "ab".repeat(32);
    assert.equal(
      marketWatchExplorerUrl(4663, hash),
      `https://robinhoodchain.blockscout.com/tx/${hash}`,
    );
    assert.equal(marketWatchExplorerUrl(4663, "not-a-hash"), null);
  });
});

describe("Market Watch 1.0B UI and feed sources", () => {
  it("uses THE WOOD NOTICES, not Market Watch branding", () => {
    assert.equal(CLEARING_WOOD_NOTICES_HEADING, "THE WOOD NOTICES");
    const item = read("src/components/clearing/market-watch-feed-item.tsx");
    assert.match(item, /THE WOOD NOTICES|CLEARING_WOOD_NOTICES_HEADING/);
    assert.match(item, /VIEW TRANSACTION/);
    assert.match(item, /A wallet entered|CLEARING_WOOD_NOTICES_LEAD/);
    assert.doesNotMatch(item, /BUY|whale|moon|rocket|bullish/i);
    assert.doesNotMatch(item, /Market Watch|market watch/i);
    assert.match(item, /aria-labelledby/);
    assert.match(item, /aria-label=\{`View transaction/);
  });

  it("feed item boundary routes kinds without trusting browser insertion", () => {
    const bridge = read("src/components/clearing/clearing-feed-item.tsx");
    assert.match(bridge, /isClearingMessageItem/);
    assert.match(bridge, /isMarketWatchFeedItem/);
    assert.match(bridge, /MarketWatchFeedItem/);
    assert.match(bridge, /notice|world_event|greenwood/);
  });

  it("feed loader merges published acquisitions only", () => {
    const feed = read("src/lib/clearing/feed.ts");
    assert.match(feed, /market_watch_events/);
    assert.match(feed, /event_type.*acquisition|eq\("event_type", "acquisition"\)/);
    assert.match(feed, /eq\("status", "published"\)/);
    assert.match(feed, /toSafeMarketWatchItem|kind: "market_watch"/);
    assert.doesNotMatch(feed, /status.*observed|disposal.*feed|client\.insert/);
  });

  it("single public poll path unchanged — no second MW poll", () => {
    const page = read("src/components/clearing/clearing-page.tsx");
    assert.match(page, /\/api\/clearing\/feed/);
    assert.match(page, /filterFeedItems/);
    assert.doesNotMatch(page, /\/api\/market-watch|market-watch\/feed|eth_getLogs|viem/);
    assert.doesNotMatch(page, /POLL_MS.*2|setInterval.*market/i);
    const counts = page.split("/api/clearing/feed").length - 1;
    assert.ok(counts >= 1);
  });

  it("worker and market-watch lib are not altered for display thresholds", () => {
    const worker = read("scripts/market-watch-worker.ts");
    assert.doesNotMatch(worker, /THE WOOD NOTICES|clearing_messages/);
    // Public feed never re-implements dust suppress
    const feed = read("src/lib/clearing/feed.ts");
    assert.doesNotMatch(feed, /min_display|minDisplay|dust/);
  });

  it("no browser chain reads in Clearing components", () => {
    for (const rel of [
      "src/components/clearing/clearing-page.tsx",
      "src/components/clearing/market-watch-feed-item.tsx",
      "src/components/clearing/clearing-feed-item.tsx",
    ]) {
      const src = read(rel);
      assert.doesNotMatch(
        src,
        /createRobinhoodPublicClient|getLogs|ROBINHOOD_CHAIN_RPC/,
      );
    }
  });
});
