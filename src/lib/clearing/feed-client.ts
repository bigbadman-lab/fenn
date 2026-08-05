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

/**
 * Newest item in chronological (oldest→newest) conversation order.
 */
export function newestFeedItem(
  items: SafeClearingFeedItem[],
): SafeClearingFeedItem | null {
  if (items.length === 0) return null;
  return items[items.length - 1] ?? null;
}

/**
 * Encode client cursor for incremental poll (`since`) — same form as load-older.
 *
 * Pure base64url over UTF-8. Avoid Buffer "base64url" encoding in the
 * browser path: some client Buffer polyfills throw Unknown encoding, which
 * can crash React if called inside a setState updater (error boundary page).
 */
export function encodeClientFeedCursor(
  occurredAt: string,
  id: string,
): string {
  const raw = `${occurredAt}|${id}`;
  const bytes = new TextEncoder().encode(raw);

  // Node Buffer path using standard base64 (always supported) → base64url.
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    try {
      return Buffer.from(bytes)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    } catch {
      // fall through to btoa
    }
  }

  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  // Last resort: manual base64 (tests / unusual runtimes).
  return manualBase64Url(bytes);
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function manualBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64_ALPHABET[(triple >> 18) & 63];
    out += BASE64_ALPHABET[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63] : "";
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : "";
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Whether merge would add any new ids (no-change poll detection).
 */
export function feedPollHasAdditions(
  existing: SafeClearingFeedItem[],
  incoming: SafeClearingFeedItem[],
): boolean {
  if (incoming.length === 0) return false;
  return findNewMessages(existing, incoming).length > 0;
}

/**
 * Merge for poll: return previous array reference when nothing new.
 */
export function mergePollFeed(
  existing: SafeClearingFeedItem[],
  incoming: SafeClearingFeedItem[],
): { next: SafeClearingFeedItem[]; added: SafeClearingFeedItem[] } {
  if (incoming.length === 0) {
    return { next: existing, added: [] };
  }
  const added = findNewMessages(existing, incoming);
  if (added.length === 0) {
    return { next: existing, added: [] };
  }
  return {
    next: mergeConversationMessages(existing, incoming),
    added,
  };
}

/** Compare public feed room state without unnecessary updates. */
export function clearingStateEqual(
  a: { readOnly: boolean; slowModeSeconds: number },
  b: { readOnly: boolean; slowModeSeconds: number },
): boolean {
  return a.readOnly === b.readOnly && a.slowModeSeconds === b.slowModeSeconds;
}
