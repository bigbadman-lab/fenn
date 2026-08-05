import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  clampFeedLimit,
  decodeFeedCursor,
  encodeFeedCursor,
  toSafeClearingMessage,
  type SafeClearingFeedPage,
} from "@/lib/clearing/dto";
import { ClearingError } from "@/lib/clearing/errors";
import { getClearingState } from "@/lib/clearing/state";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Public published-message feed. Newest first. Cursor pagination.
 * Shape is ready for future union kinds (market_watch, etc.).
 */
export async function getClearingFeed(input: {
  limit?: unknown;
  cursor?: string | null;
  admin?: SupabaseClient;
}): Promise<SafeClearingFeedPage> {
  const admin = input.admin ?? (await defaultAdmin());
  const limit = clampFeedLimit(input.limit);
  const cursor = decodeFeedCursor(input.cursor);

  let query = admin
    .from("clearing_messages")
    .select(
      "id, author_type, author_display_name_snapshot, body, created_at, status",
    )
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    // (created_at, id) < cursor for reverse chrono.
    // Quote timestamps for PostgREST (colons / special chars).
    const createdAt = `"${cursor.createdAt.replace(/"/g, "")}"`;
    const id = cursor.id;
    query = query.or(
      `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`,
    );
  }

  const [{ data, error }, state] = await Promise.all([
    query,
    getClearingState(admin),
  ]);
  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to load Clearing feed",
      500,
    );
  }

  const rows = data ?? [];
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeFeedCursor(String(last.created_at), String(last.id))
      : null;

  return {
    items: page.map((row) =>
      toSafeClearingMessage({
        id: String(row.id),
        author_type: String(row.author_type),
        author_display_name_snapshot: String(row.author_display_name_snapshot),
        body: String(row.body),
        created_at: String(row.created_at),
      }),
    ),
    nextCursor,
    state: {
      readOnly: state.readOnly,
      slowModeSeconds: state.slowModeSeconds,
    },
  };
}
