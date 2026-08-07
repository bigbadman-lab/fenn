/**
 * Fail-closed aggregator for homepage live ticker.
 * No event store — derives from existing public readers only.
 */

import type { PublicChronicleEntry } from "@/lib/chronicle/types";
import type { SafeDeed } from "@/lib/deeds/types";
import type { PublicHomeGatheringCall } from "@/lib/greenwood/gatherings/public-home-signal-types";
import type { PublicLedgerRecognition } from "@/lib/ledger/types";
import { collapseWs } from "@/lib/live-ticker/format";
import type {
  LiveTickerItem,
  LiveTickerType,
} from "@/lib/live-ticker/types";
import {
  LIVE_TICKER_MAX_ITEMS,
  LIVE_TICKER_TEXT_MAX_CHARS,
  LIVE_TICKER_WALL_BODY_MAX_CHARS,
} from "@/lib/live-ticker/types";
import type { PublicWallEntry } from "@/lib/wall/types";

export function tickerItemId(type: LiveTickerType, sourceId: string): string {
  return `${type}:${sourceId}`;
}

export function isCleanShortHeadline(
  value: string,
  maxChars: number,
): boolean {
  const t = collapseWs(value);
  if (!t) return false;
  if (t.length > maxChars) return false;
  if (/[\r\n]/.test(value)) return false;
  if (/0x[a-fA-F0-9]{20,}/.test(t)) return false;
  if (/@\w{2,}/.test(t)) return false;
  return true;
}

export function mapDeedToTickerItem(deed: SafeDeed): LiveTickerItem | null {
  const at = deed.publishedAt ?? deed.startsAt;
  if (!at) return null;
  const title = collapseWs(deed.title);
  if (!title) return null;
  const text = `NEW DEED — ${title}`.slice(0, LIVE_TICKER_TEXT_MAX_CHARS);
  const href = deed.slug ? `/deeds/${deed.slug}` : "/deeds";
  return {
    id: tickerItemId("deed", deed.id),
    type: "deed",
    occurredAt: at,
    label: "NEW DEED",
    text,
    href,
  };
}

export function mapBookToTickerItem(
  entry: PublicChronicleEntry,
): LiveTickerItem | null {
  if (!entry.publishedAt) return null;
  const title = entry.title ? collapseWs(entry.title) : "";
  const useTitle =
    title.length > 0 &&
    isCleanShortHeadline(title, LIVE_TICKER_TEXT_MAX_CHARS - 12);
  const text = useTitle
    ? title.toUpperCase().slice(0, LIVE_TICKER_TEXT_MAX_CHARS)
    : "THE BOOK WAS WRITTEN";
  return {
    id: tickerItemId("book", entry.id),
    type: "book",
    occurredAt: entry.publishedAt,
    label: "THE BOOK",
    text,
    href: "/book",
  };
}

export function mapWallToTickerItem(entry: PublicWallEntry): LiveTickerItem | null {
  if (!entry.createdAt) return null;
  const raw = entry.body ?? "";
  // Multi-line Wall bodies stay off the wire (check raw before collapse).
  const compact = collapseWs(raw);
  const useBody =
    !/[\r\n]/.test(raw) &&
    isCleanShortHeadline(compact, LIVE_TICKER_WALL_BODY_MAX_CHARS) &&
    !/^\s*$/.test(compact);
  const text = useBody
    ? compact.toUpperCase()
    : "THE WALL WAS INSCRIBED";
  return {
    id: tickerItemId("wall", entry.id),
    type: "wall",
    occurredAt: entry.createdAt,
    label: "WALL",
    text: text.slice(0, LIVE_TICKER_TEXT_MAX_CHARS),
    href: "/wall",
  };
}

export function mapLeafToTickerItem(
  rec: PublicLedgerRecognition,
): LiveTickerItem | null {
  if (!rec.createdAt) return null;
  // Never surface amounts, wallets, or raw reasons.
  let text = "LEAF RECOGNISED";
  if (rec.deedTitle && isCleanShortHeadline(rec.deedTitle, 40)) {
    text = `LEAF RECOGNISED — ${collapseWs(rec.deedTitle).toUpperCase()}`;
  }
  return {
    id: tickerItemId("leaf", rec.id),
    type: "leaf",
    occurredAt: rec.createdAt,
    label: "LEAF",
    text: text.slice(0, LIVE_TICKER_TEXT_MAX_CHARS),
    href: "/ledger",
  };
}

export function mapGatheringToTickerItem(
  signal: PublicHomeGatheringCall,
): LiveTickerItem | null {
  if (!signal.active) return null;
  return {
    id: tickerItemId("gathering", `active:${signal.startsAt}`),
    type: "gathering",
    occurredAt: signal.startsAt,
    label: "GATHERING",
    text: "GATHERING — THE FIRE IS OPEN",
    href: signal.href,
  };
}

/** Merge, sort newest first, unique by id, cap. */
export function finaliseLiveTickerItems(
  items: LiveTickerItem[],
  max = LIVE_TICKER_MAX_ITEMS,
): LiveTickerItem[] {
  const byId = new Map<string, LiveTickerItem>();
  for (const item of items) {
    if (!item.id || !item.occurredAt || !item.text) continue;
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()]
    .sort((a, b) => {
      const bt = Date.parse(b.occurredAt);
      const at = Date.parse(a.occurredAt);
      if (Number.isFinite(bt) && Number.isFinite(at) && bt !== at) {
        return bt - at;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, max);
}

export type LiveTickerLoaders = {
  loadDeeds?: () => Promise<SafeDeed[]>;
  loadBooks?: () => Promise<PublicChronicleEntry[]>;
  loadWall?: () => Promise<PublicWallEntry[]>;
  loadLeaf?: () => Promise<PublicLedgerRecognition[]>;
  loadGathering?: () => Promise<PublicHomeGatheringCall>;
};

async function settleOrEmpty<T>(p: Promise<T>, empty: T): Promise<T> {
  try {
    return await p;
  } catch {
    return empty;
  }
}

/**
 * Build homepage live ticker items from trusted public readers.
 * Per-source fail closed. No Register. No private data.
 */
export async function buildHomeLiveTicker(
  loaders: LiveTickerLoaders = {},
): Promise<LiveTickerItem[]> {
  const loadDeeds =
    loaders.loadDeeds ??
    (async () => {
      const { listPublicDeeds } = await import("@/lib/deeds/queries");
      return listPublicDeeds();
    });
  const loadBooks =
    loaders.loadBooks ??
    (async () => {
      const { listPublicChronicleEntries } = await import(
        "@/lib/chronicle/read"
      );
      return listPublicChronicleEntries({ limit: 3 });
    });
  const loadWall =
    loaders.loadWall ??
    (async () => {
      const { listPublicWallEntries } = await import("@/lib/wall/read");
      return listPublicWallEntries({ limit: 4 });
    });
  const loadLeaf =
    loaders.loadLeaf ??
    (async () => {
      const { listPublicLeafRecognitions } = await import(
        "@/lib/ledger/page-data"
      );
      const { entries } = await listPublicLeafRecognitions({ limit: 4 });
      return entries;
    });
  const loadGathering =
    loaders.loadGathering ??
    (async () => {
      const { getPublicHomeGatheringCall } = await import(
        "@/lib/greenwood/gatherings/public-home-signal"
      );
      return getPublicHomeGatheringCall();
    });

  const [deeds, books, wall, leaf, gathering] = await Promise.all([
    settleOrEmpty(loadDeeds(), []),
    settleOrEmpty(loadBooks(), []),
    settleOrEmpty(loadWall(), []),
    settleOrEmpty(loadLeaf(), []),
    settleOrEmpty(loadGathering(), {
      active: false as const,
      serverNow: new Date().toISOString(),
    }),
  ]);

  const items: LiveTickerItem[] = [];

  for (const d of deeds.slice(0, 4)) {
    const item = mapDeedToTickerItem(d);
    if (item) items.push(item);
  }
  for (const b of books.slice(0, 3)) {
    const item = mapBookToTickerItem(b);
    if (item) items.push(item);
  }
  for (const w of wall.slice(0, 4)) {
    const item = mapWallToTickerItem(w);
    if (item) items.push(item);
  }
  for (const l of leaf.slice(0, 4)) {
    const item = mapLeafToTickerItem(l);
    if (item) items.push(item);
  }
  const g = mapGatheringToTickerItem(gathering);
  if (g) items.push(g);

  return finaliseLiveTickerItems(items);
}
