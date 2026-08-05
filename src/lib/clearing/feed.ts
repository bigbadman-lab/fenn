import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  clampFeedLimit,
  decodeFeedCursor,
  encodeFeedCursor,
  toSafeClearingMessage,
  type SafeClearingFeedItem,
  type SafeClearingFeedPage,
  type SafeMarketWatchFeedItem,
} from "@/lib/clearing/dto";
import { ClearingError } from "@/lib/clearing/errors";
import {
  formatClearingMarketFennAmount,
  marketWatchExplorerUrl,
} from "@/lib/clearing/market-display";
import { getClearingState } from "@/lib/clearing/state";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type InternalFeedRow = {
  sortAt: string;
  sortId: string;
  item: SafeClearingFeedItem;
};

function compareNewestFirst(a: InternalFeedRow, b: InternalFeedRow): number {
  const ta = Date.parse(a.sortAt);
  const tb = Date.parse(b.sortAt);
  if (ta !== tb) return tb - ta;
  if (a.sortId === b.sortId) return 0;
  return a.sortId < b.sortId ? 1 : -1;
}

function postgrestOlderThan(
  timeColumn: string,
  cursor: { createdAt: string; id: string },
): string {
  const createdAt = `"${cursor.createdAt.replace(/"/g, "")}"`;
  const id = cursor.id;
  return `${timeColumn}.lt.${createdAt},and(${timeColumn}.eq.${createdAt},id.lt.${id})`;
}

async function loadTokenDecimals(
  admin: SupabaseClient,
): Promise<{ decimals: number; symbol: string }> {
  try {
    const { data } = await admin
      .from("market_watch_config")
      .select("token_decimals, token_symbol")
      .eq("id", 1)
      .maybeSingle();
    const decimals =
      data &&
      typeof data.token_decimals === "number" &&
      Number.isInteger(data.token_decimals) &&
      data.token_decimals >= 0 &&
      data.token_decimals <= 255
        ? data.token_decimals
        : 18;
    const symbol =
      data && typeof data.token_symbol === "string" && data.token_symbol.trim()
        ? data.token_symbol.trim()
        : "FENN";
    return { decimals, symbol };
  } catch {
    return { decimals: 18, symbol: "FENN" };
  }
}

function toSafeMarketWatchItem(
  row: {
    id: string;
    published_at: string | null;
    fenn_amount_raw: string | number;
    transaction_hash: string;
    chain_id: number;
  },
  decimals: number,
  symbol: string,
): SafeMarketWatchFeedItem | null {
  if (!row.published_at) return null;
  const amountLabel = formatClearingMarketFennAmount(
    String(row.fenn_amount_raw),
    decimals,
    symbol,
  );
  return {
    kind: "market_watch",
    id: String(row.id),
    occurredAt: String(row.published_at),
    amountLabel,
    transactionUrl: marketWatchExplorerUrl(
      Number(row.chain_id) || ROBINHOOD_CHAIN_ID,
      String(row.transaction_hash),
    ),
  };
}

/**
 * Public Clearing feed: published human messages + published acquisition world events.
 * Newest first. Server-side merge only. Suppresses observed/disposal/reorged.
 */
export async function getClearingFeed(input: {
  limit?: unknown;
  cursor?: string | null;
  admin?: SupabaseClient;
}): Promise<SafeClearingFeedPage> {
  const admin = input.admin ?? (await defaultAdmin());
  const limit = clampFeedLimit(input.limit);
  const cursor = decodeFeedCursor(input.cursor);
  const fetchLimit = limit + 1;

  let messagesQuery = admin
    .from("clearing_messages")
    .select(
      "id, author_type, author_display_name_snapshot, body, created_at, status",
    )
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(fetchLimit);

  if (cursor) {
    messagesQuery = messagesQuery.or(
      postgrestOlderThan("created_at", cursor),
    );
  }

  // Published acquisitions only — never observed/suppressed/disposal/reorged.
  let marketQuery = admin
    .from("market_watch_events")
    .select(
      "id, published_at, fenn_amount_raw, transaction_hash, chain_id, status, event_type",
    )
    .eq("status", "published")
    .eq("event_type", "acquisition")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(fetchLimit);

  if (cursor) {
    marketQuery = marketQuery.or(postgrestOlderThan("published_at", cursor));
  }

  const [messagesResult, marketResult, state, tokenMeta] = await Promise.all([
    messagesQuery,
    marketQuery,
    getClearingState(admin),
    loadTokenDecimals(admin),
  ]);

  if (messagesResult.error) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to load Clearing feed",
      500,
    );
  }

  // Market Watch table may be absent on environments that have not applied
  // migration 50 yet — fail open to messages-only rather than blank the room.
  const marketRows =
    marketResult.error || !marketResult.data ? [] : marketResult.data;

  const rows: InternalFeedRow[] = [];

  for (const row of messagesResult.data ?? []) {
    const item = toSafeClearingMessage({
      id: String(row.id),
      author_type: String(row.author_type),
      author_display_name_snapshot: String(row.author_display_name_snapshot),
      body: String(row.body),
      created_at: String(row.created_at),
    });
    rows.push({
      sortAt: item.occurredAt,
      sortId: item.id,
      item,
    });
  }

  for (const row of marketRows) {
    // Defensive filter — query already constrains, but never leak wrong rows.
    if (String(row.status) !== "published") continue;
    if (String(row.event_type) !== "acquisition") continue;
    const item = toSafeMarketWatchItem(
      {
        id: String(row.id),
        published_at: row.published_at == null ? null : String(row.published_at),
        fenn_amount_raw: row.fenn_amount_raw as string | number,
        transaction_hash: String(row.transaction_hash),
        chain_id: Number(row.chain_id),
      },
      tokenMeta.decimals,
      tokenMeta.symbol,
    );
    if (!item) continue;
    rows.push({
      sortAt: item.occurredAt,
      sortId: item.id,
      item,
    });
  }

  rows.sort(compareNewestFirst);
  const pageRows = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeFeedCursor(last.sortAt, last.sortId)
      : null;

  return {
    items: pageRows.map((r) => r.item),
    nextCursor,
    state: {
      readOnly: state.readOnly,
      slowModeSeconds: state.slowModeSeconds,
    },
  };
}

/** Pure merge for unit tests — newest-first input lists of already-safe items. */
export function mergeClearingFeedSources(
  messages: SafeClearingFeedItem[],
  marketWatch: SafeClearingFeedItem[],
  limit: number,
): { items: SafeClearingFeedItem[]; hasMore: boolean } {
  const rows: InternalFeedRow[] = [...messages, ...marketWatch].map((item) => ({
    sortAt: item.occurredAt,
    sortId: item.id,
    item,
  }));
  rows.sort(compareNewestFirst);
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => r.item),
    hasMore: rows.length > limit,
  };
}
