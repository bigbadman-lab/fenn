import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { WallError } from "@/lib/wall/errors";
import { countMarksForEntry } from "@/lib/wall/read";
import type { LeaveWallMarkResult } from "@/lib/wall/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "23505" ||
    Boolean(error.message?.toLowerCase().includes("duplicate key"))
  );
}

export function assertWallEntryId(entryId: string): string {
  const trimmed = entryId.trim();
  if (!UUID_RE.test(trimmed)) {
    throw new WallError(
      "wall_invalid_entry_id",
      "Wall entry id must be a UUID",
      400,
    );
  }
  return trimmed;
}

async function wallEntryExists(
  admin: SupabaseClient,
  entryId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("wall_entries")
    .select("id")
    .eq("id", entryId)
    .maybeSingle();
  if (error) {
    throw new WallError(
      "wall_read_failed",
      "Failed to verify Wall entry",
      500,
    );
  }
  return Boolean(data);
}

/**
 * Leave a permanent mark for a registered Outlaw.
 * profileId must be server-resolved — never from the client body.
 * Idempotent: duplicate returns already_marked without a second row.
 */
export async function leaveWallMark(
  entryId: string,
  profileId: string,
  admin?: SupabaseClient,
): Promise<LeaveWallMarkResult> {
  const db = admin ?? (await defaultAdmin());
  const id = assertWallEntryId(entryId);
  const profile = profileId.trim();
  if (!UUID_RE.test(profile)) {
    throw new WallError(
      "wall_mark_failed",
      "Invalid profile for Wall mark",
      500,
    );
  }

  if (!(await wallEntryExists(db, id))) {
    throw new WallError(
      "wall_entry_not_found",
      "Wall entry not found",
      404,
    );
  }

  const { error } = await db.from("wall_marks").insert({
    entry_id: id,
    profile_id: profile,
  });

  if (error) {
    if (isUniqueViolation(error)) {
      const count = await countMarksForEntry(id, db);
      return { status: "already_marked", count };
    }
    throw new WallError(
      "wall_mark_failed",
      "Failed to leave Wall mark",
      500,
    );
  }

  const count = await countMarksForEntry(id, db);
  return { status: "marked", count };
}

/**
 * Which of the given entry IDs the profile has already marked.
 * Returns only booleans for the current profile — never other reactors.
 */
export async function getMarkedEntryIdsForProfile(
  profileId: string,
  entryIds: string[],
  admin?: SupabaseClient,
): Promise<Set<string>> {
  const db = admin ?? (await defaultAdmin());
  const profile = profileId.trim();
  if (!UUID_RE.test(profile)) {
    throw new WallError(
      "wall_mark_failed",
      "Invalid profile for Wall mark status",
      500,
    );
  }

  const ids = [...new Set(entryIds.map((id) => id.trim()).filter(Boolean))];
  const valid = ids.filter((id) => UUID_RE.test(id));
  if (valid.length === 0) return new Set();

  const { data, error } = await db
    .from("wall_marks")
    .select("entry_id")
    .eq("profile_id", profile)
    .in("entry_id", valid);

  if (error) {
    throw new WallError(
      "wall_read_failed",
      "Failed to load Wall mark status",
      500,
    );
  }

  return new Set(
    (data ?? []).map((row) => (row as { entry_id: string }).entry_id),
  );
}
