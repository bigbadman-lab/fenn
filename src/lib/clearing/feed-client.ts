/**
 * Client-safe Clearing feed helpers (no server-only imports).
 */

import type { SafeClearingMessage } from "@/lib/clearing/dto";

/** Feed item kinds the UI understands. Unknown kinds are ignored. */
export type ClearingFeedItem = SafeClearingMessage | { kind: string; id?: string };

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

/** Chronological compare: older first (conversation order). */
export function compareMessageChronological(
  a: SafeClearingMessage,
  b: SafeClearingMessage,
): number {
  const ta = Date.parse(a.occurredAt);
  const tb = Date.parse(b.occurredAt);
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Reverse API newest-first page into conversation order. */
export function newestFirstToConversation(
  items: SafeClearingMessage[],
): SafeClearingMessage[] {
  return [...items].reverse();
}

/**
 * Merge feed items by id. Keeps conversation order (oldest → newest).
 * `incoming` may be any order; `existing` is already chronological.
 */
export function mergeConversationMessages(
  existing: SafeClearingMessage[],
  incoming: SafeClearingMessage[],
): SafeClearingMessage[] {
  if (incoming.length === 0) return existing;
  const map = new Map<string, SafeClearingMessage>();
  for (const m of existing) map.set(m.id, m);
  for (const m of incoming) map.set(m.id, m);
  return Array.from(map.values()).sort(compareMessageChronological);
}

/** Messages in `incoming` that are not in `existing` (by id). */
export function findNewMessages(
  existing: SafeClearingMessage[],
  incoming: SafeClearingMessage[],
): SafeClearingMessage[] {
  const have = new Set(existing.map((m) => m.id));
  return incoming.filter((m) => !have.has(m.id));
}

export function filterMessageItems(items: unknown[]): SafeClearingMessage[] {
  return items.filter(isClearingMessageItem);
}

export function remainingLabel(remaining: number): string {
  if (remaining <= 0) return "0 messages remain.";
  if (remaining === 1) return "1 message remains.";
  return `${remaining} messages remain.`;
}
