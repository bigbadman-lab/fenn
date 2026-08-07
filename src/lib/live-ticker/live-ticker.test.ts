import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildHomeLiveTicker,
  finaliseLiveTickerItems,
  isCleanShortHeadline,
  mapBookToTickerItem,
  mapDeedToTickerItem,
  mapLeafToTickerItem,
  mapWallToTickerItem,
  tickerItemId,
} from "@/lib/live-ticker/build-home-live-ticker";
import { LIVE_TICKER_MAX_ITEMS } from "@/lib/live-ticker/types";
import { WORLD_PULSE_LIVE_TICKER_MS } from "@/lib/world-pulse/intervals";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("live ticker pure mapping", () => {
  it("builds stable ids with type prefix", () => {
    assert.equal(tickerItemId("deed", "abc"), "deed:abc");
    assert.equal(tickerItemId("wall", "w1"), "wall:w1");
  });

  it("maps deeds with title and public href", () => {
    const item = mapDeedToTickerItem({
      id: "d1",
      slug: "old-road",
      title: "The Old Road",
      loreDescription: "",
      instructions: "",
      category: null,
      accessScope: "road",
      status: "active",
      reward: { type: "none" },
      evidenceRequirements: {
        text: { allowed: true, required: false },
        url: { allowed: false, required: false },
        image: { allowed: false, required: false },
        other: { allowed: false, required: false },
      },
      evidenceRequirementsInvalid: false,
      startsAt: null,
      endsAt: null,
      maxCompletions: null,
      completionsCount: 0,
      isRepeatable: false,
      isPublic: true,
      sponsorName: null,
      externalRewardNote: null,
      publishedAt: "2026-08-07T12:04:00.000Z",
    });
    assert.ok(item);
    assert.equal(item!.id, "deed:d1");
    assert.match(item!.text, /NEW DEED — The Old Road/);
    assert.equal(item!.href, "/deeds/old-road");
  });

  it("truncates or replaces wall bodies when unsuitable", () => {
    const short = mapWallToTickerItem({
      id: "w1",
      body: "kept at oak",
      createdAt: "2026-08-07T11:00:00.000Z",
      markCount: 0,
    });
    assert.equal(short!.text, "KEPT AT OAK");

    const long = mapWallToTickerItem({
      id: "w2",
      body: "a very long wall inscription that goes on and on past the limit for the ticker strip completely",
      createdAt: "2026-08-07T11:00:00.000Z",
      markCount: 0,
    });
    assert.equal(long!.text, "THE WALL WAS INSCRIBED");

    const multi = mapWallToTickerItem({
      id: "w3",
      body: "line one\nline two",
      createdAt: "2026-08-07T11:00:00.000Z",
      markCount: 0,
    });
    assert.equal(multi!.text, "THE WALL WAS INSCRIBED");
  });

  it("LEAF never includes amounts or wallets", () => {
    const item = mapLeafToTickerItem({
      id: "l1",
      createdAt: "2026-08-07T10:00:00.000Z",
      amount: 999,
      lifetimeDelta: 999,
      category: "DEED",
      summary: "should not appear",
      outlawLabel: "OUTLAW 7",
      outlawNumber: 7,
      deedTitle: "Path Work",
    });
    assert.ok(item);
    assert.doesNotMatch(item!.text, /999|wallet|0x|OUTLAW 7/i);
    assert.match(item!.text, /LEAF RECOGNISED/);
    assert.match(item!.text, /PATH WORK/);
    assert.equal(item!.href, "/ledger");
  });

  it("book falls back when title is messy", () => {
    const item = mapBookToTickerItem({
      id: "b1",
      kind: "daily",
      title: null,
      body: "body",
      coveredDate: "2026-08-07",
      publishedAt: "2026-08-07T00:05:00.000Z",
    });
    assert.equal(item!.text, "THE BOOK WAS WRITTEN");
    assert.equal(item!.href, "/book");
  });

  it("rejects unclean headlines", () => {
    assert.equal(isCleanShortHeadline("ok short", 20), true);
    assert.equal(
      isCleanShortHeadline("0x1234567890abcdef1234567890abcdef12345678", 80),
      false,
    );
  });
});

describe("live ticker merge and sort", () => {
  it("sorts by occurredAt descending and caps at 10", () => {
    const items = finaliseLiveTickerItems(
      Array.from({ length: 15 }, (_, i) => ({
        id: `deed:d${i}`,
        type: "deed" as const,
        occurredAt: `2026-08-07T${String(i).padStart(2, "0")}:00:00.000Z`,
        label: "NEW DEED",
        text: `NEW DEED — ${i}`,
      })),
    );
    assert.equal(items.length, LIVE_TICKER_MAX_ITEMS);
    assert.equal(items[0]!.id, "deed:d14");
    assert.equal(items[items.length - 1]!.id, "deed:d5");
  });

  it("returns empty when sources empty", async () => {
    const items = await buildHomeLiveTicker({
      loadDeeds: async () => [],
      loadBooks: async () => [],
      loadWall: async () => [],
      loadLeaf: async () => [],
      loadGathering: async () => ({
        active: false,
        serverNow: "2026-08-07T12:00:00.000Z",
      }),
    });
    assert.deepEqual(items, []);
  });

  it("merges sources and fail-closes bad loaders", async () => {
    const items = await buildHomeLiveTicker({
      loadDeeds: async () => {
        throw new Error("deeds down");
      },
      loadBooks: async () => [
        {
          id: "b1",
          kind: "daily",
          title: "Day One",
          body: "x",
          coveredDate: "2026-08-07",
          publishedAt: "2026-08-07T09:00:00.000Z",
        },
      ],
      loadWall: async () => [
        {
          id: "w1",
          body: "mark left",
          createdAt: "2026-08-07T11:00:00.000Z",
          markCount: 1,
        },
      ],
      loadLeaf: async () => {
        throw new Error("leaf down");
      },
      loadGathering: async () => ({
        active: true,
        state: "active",
        startsAt: "2026-08-07T08:00:00.000Z",
        endsAt: "2026-08-07T20:00:00.000Z",
        message: "GATHERING CALLED AT THE GREENWOOD",
        href: "/greenwood?crossing=1",
        serverNow: "2026-08-07T12:00:00.000Z",
      }),
    });
    assert.ok(items.some((i) => i.type === "book"));
    assert.ok(items.some((i) => i.type === "wall"));
    assert.ok(items.some((i) => i.type === "gathering"));
    assert.ok(!items.some((i) => i.type === "deed"));
    assert.ok(!items.some((i) => i.type === "leaf"));
    assert.ok(items[0]!.occurredAt >= items[items.length - 1]!.occurredAt);
  });
});

describe("live ticker surface wiring", () => {
  it("uses 25s world pulse interval", () => {
    assert.equal(WORLD_PULSE_LIVE_TICKER_MS, 25_000);
  });

  it("homepage places HomeLiveTicker before HomeWelcome", () => {
    const page = read("src/app/page.tsx");
    const ticker = page.indexOf("<HomeLiveTicker");
    const welcome = page.indexOf("<HomeWelcome");
    assert.ok(ticker >= 0 && welcome > ticker);
  });

  it("public live-ticker route is no-store and unauthenticated", () => {
    const route = read("src/app/api/home/live-ticker/route.ts");
    assert.match(route, /buildHomeLiveTicker/);
    assert.match(route, /force-dynamic|dynamic = "force-dynamic"/);
    assert.match(route, /no-store/);
    assert.doesNotMatch(route, /requireFennDeskAccess|requireAuth|getSession/);
    assert.doesNotMatch(route, /register|outlawLabel|wallet/i);
  });

  it("client ticker uses usePagePulse and no shell/auth", () => {
    const ui = read("src/components/home/home-live-ticker.tsx");
    assert.match(ui, /usePagePulse/);
    assert.match(ui, /WORLD_PULSE_LIVE_TICKER_MS/);
    assert.match(ui, /\/api\/home\/live-ticker/);
    assert.match(ui, /NEW SIGNAL/);
    assert.match(ui, /LISTENING/);
    assert.doesNotMatch(ui, /ApplicationShell|requireFennDeskAccess/);
    assert.doesNotMatch(ui, /profiles|register members|wallet/i);
  });

  it("aggregator does not reference Register or migrations", () => {
    const agg = read("src/lib/live-ticker/build-home-live-ticker.ts");
    assert.match(agg, /listPublicDeeds/);
    assert.match(agg, /listPublicChronicleEntries/);
    assert.match(agg, /listPublicWallEntries/);
    assert.match(agg, /listPublicLeafRecognitions/);
    assert.doesNotMatch(agg, /listDeskRegister|newOutlaws|Register activity/);
    assert.doesNotMatch(agg, /CREATE TABLE|migration/);
  });

  it("no live-ticker migration introduced", () => {
    const mig = read(
      "supabase/migrations/20260807100000_52_editorial_30_package.sql",
    );
    assert.doesNotMatch(mig, /live.ticker|live_ticker/i);
  });
});
