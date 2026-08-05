/**
 * Client-safe Clearing feed helpers (no server-only imports).
 */

import type {
  SafeClearingFeedItem,
  SafeClearingMessage,
  SafeMarketWatchFeedItem,
} from "@/lib/clearing/dto";

/** Feed item kinds the UI understands. Unknown kinds are ignored. */
export type ClearingFeedItem = SafeClearingFeedItem | { kind: string; id?: string };

export function isClearingMessageItem(
  item: unknown,
): item is SafeClearingMessage {
  if (!item || typeof item !== "object") return false;
  const row = item as Record<string, unknown>;
  if (row.kind !== "message") return false;
  if (typeof row.id !== "string" || !row.id) return false;
  if (typeof row.occurredAt !== "string") return false;
  if (typeof row.body !== "string") return false;
  const author = row.author as Record<string, unknown> | undefined;
  if (!author || typeof author.label !== "string") return false;
  if (
    author.type !== "traveller" &&
    author.type !== "outlaw" &&
    author.type !== "keeper"
  ) {
    return false;
  }
  return true;
}

export function isMarketWatchFeedItem(
  item: unknown,
): item is SafeMarketWatchFeedItem {
  if (!item || typeof item !== "object") return false;
  const row = item as Record<string, unknown>;
  if (row.kind !== "market_watch") return false;
  if (typeof row.id !== "string" || !row.id) return false;
  if (typeof row.occurredAt !== "string") return false;
  if (typeof row.amountLabel !== "string" || !row.amountLabel) return false;
  if (row.transactionUrl != null && typeof row.transactionUrl !== "string") {
    return false;
  }
  return true;
}

/** Accept known public feed kinds; ignore unknown future kinds. */
export function isClearingFeedItem(item: unknown): item is SafeClearingFeedItem {
  return isClearingMessageItem(item) || isMarketWatchFeedItem(item);
}

/** Chronological compare: older first (conversation order). */
export function compareFeedChronological(
  a: SafeClearingFeedItem,
  b: SafeClearingFeedItem,
): number {
  const ta = Date.parse(a.occurredAt);
  const tb = Date.parse(b.occurredAt);
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** @deprecated Prefer compareFeedChronological — same semantics for messages. */
export function compareMessageChronological(
  a: SafeClearingMessage,
  b: SafeClearingMessage,
): number {
  return compareFeedChronological(a, b);
}

/** Reverse API newest-first page into conversation order. */
export function newestFirstToConversation<T extends SafeClearingFeedItem>(
  items: T[],
): T[] {
  return [...items].reverse();
}

/**
 * Merge feed items by id. Keeps conversation order (oldest → newest).
 * `incoming` may be any order; `existing` is already chronological.
 */
export function mergeConversationMessages(
  existing: SafeClearingFeedItem[],
  incoming: SafeClearingFeedItem[],
): SafeClearingFeedItem[] {
  if (incoming.length === 0) return existing;
  const map = new Map<string, SafeClearingFeedItem>();
  for (const m of existing) map.set(m.id, m);
  for (const m of incoming) map.set(m.id, m);
  return Array.from(map.values()).sort(compareFeedChronological);
}

/** Items in `incoming` that are not in `existing` (by id). */
export function findNewMessages(
  existing: SafeClearingFeedItem[],
  incoming: SafeClearingFeedItem[],
): SafeClearingFeedItem[] {
  const have = new Set(existing.map((m) => m.id));
  return incoming.filter((m) => !have.has(m.id));
}

export function filterFeedItems(items: unknown[]): SafeClearingFeedItem[] {
  return items.filter(isClearingFeedItem);
}

/** @deprecated Prefer filterFeedItems */
export function filterMessageItems(items: unknown[]): SafeClearingMessage[] {
  return items.filter(isClearingMessageItem);
}

export function remainingLabel(remaining: number): string {
  if (remaining <= 0) return "0 messages remain.";
  if (remaining === 1) return "1 message remains.";
  return `${remaining} messages remain.`;
}
