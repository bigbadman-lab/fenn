import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { WallError } from "@/lib/wall/errors";
import type { PublicWallEntry } from "@/lib/wall/types";
import {
  PUBLIC_WALL_ENTRIES_DEFAULT_LIMIT,
  PUBLIC_WALL_ENTRIES_MAX_LIMIT,
} from "@/lib/wall/types";

type WallEntryRow = {
  id: string;
  body: string;
  created_at: string;
  source_type?: string;
  source_external_id?: string | null;
  wall_marks?: { count: number }[] | { count: number } | null;
  mark_count?: number | null;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function parseMarkCount(row: WallEntryRow): number {
  if (typeof row.mark_count === "number" && Number.isFinite(row.mark_count)) {
    return Math.max(0, Math.floor(row.mark_count));
  }
  const nested = row.wall_marks;
  if (Array.isArray(nested) && nested[0] && typeof nested[0].count === "number") {
    return Math.max(0, Math.floor(nested[0].count));
  }
  if (
    nested &&
    !Array.isArray(nested) &&
    typeof nested.count === "number"
  ) {
    return Math.max(0, Math.floor(nested.count));
  }
  return 0;
}

export function toPublicWallEntry(
  row: WallEntryRow,
  markCount?: number,
): PublicWallEntry {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    markCount:
      markCount != null
        ? Math.max(0, Math.floor(markCount))
        : parseMarkCount(row),
  };
}

/**
 * Public Wall inscriptions, newest first.
 * Includes aggregate markCount only — never who marked.
 */
export async function listPublicWallEntries(
  options?: { limit?: number; admin?: SupabaseClient },
): Promise<PublicWallEntry[]> {
  const admin = options?.admin ?? (await defaultAdmin());
  const requested = options?.limit ?? PUBLIC_WALL_ENTRIES_DEFAULT_LIMIT;
  const limit = Math.min(
    Math.max(1, Math.floor(requested)),
    PUBLIC_WALL_ENTRIES_MAX_LIMIT,
  );

  const { data, error } = await admin
    .from("wall_entries")
    .select("id, body, created_at, wall_marks(count)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    // Fallback if nested wall_marks(count) is unavailable in a given env.
    const plain = await admin
      .from("wall_entries")
      .select("id, body, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (plain.error) {
      throw new WallError(
        "wall_read_failed",
        "Failed to load Wall entries",
        500,
      );
    }
    const rows = (plain.data ?? []) as WallEntryRow[];
    const counts = await loadMarkCounts(
      admin,
      rows.map((r) => r.id),
    );
    return rows.map((row) => toPublicWallEntry(row, counts.get(row.id) ?? 0));
  }

  return (data ?? []).map((row) => toPublicWallEntry(row as WallEntryRow));
}

/** Optional single-entry read for tests / deep-link helpers. */
export async function getPublicWallEntry(
  id: string,
  admin?: SupabaseClient,
): Promise<PublicWallEntry | null> {
  const db = admin ?? (await defaultAdmin());
  const trimmed = id.trim();
  if (!trimmed) {
    throw new WallError("wall_entry_not_found", "Wall entry not found", 404);
  }

  const { data, error } = await db
    .from("wall_entries")
    .select("id, body, created_at, wall_marks(count)")
    .eq("id", trimmed)
    .maybeSingle();

  if (error) {
    const plain = await db
      .from("wall_entries")
      .select("id, body, created_at")
      .eq("id", trimmed)
      .maybeSingle();
    if (plain.error) {
      throw new WallError(
        "wall_read_failed",
        "Failed to load Wall entry",
        500,
      );
    }
    if (!plain.data) return null;
    const counts = await loadMarkCounts(db, [trimmed]);
    return toPublicWallEntry(plain.data as WallEntryRow, counts.get(trimmed) ?? 0);
  }
  if (!data) return null;
  return toPublicWallEntry(data as WallEntryRow);
}

export async function loadMarkCounts(
  admin: SupabaseClient,
  entryIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const id of entryIds) counts.set(id, 0);
  if (entryIds.length === 0) return counts;

  const { data, error } = await admin
    .from("wall_marks")
    .select("entry_id")
    .in("entry_id", entryIds);

  if (error) {
    throw new WallError(
      "wall_read_failed",
      "Failed to load Wall mark counts",
      500,
    );
  }

  for (const row of data ?? []) {
    const entryId = (row as { entry_id: string }).entry_id;
    counts.set(entryId, (counts.get(entryId) ?? 0) + 1);
  }
  return counts;
}

export async function countMarksForEntry(
  entryId: string,
  admin?: SupabaseClient,
): Promise<number> {
  const db = admin ?? (await defaultAdmin());
  const { count, error } = await db
    .from("wall_marks")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", entryId);

  if (error) {
    throw new WallError(
      "wall_read_failed",
      "Failed to count Wall marks",
      500,
    );
  }
  return count ?? 0;
}
