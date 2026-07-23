import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CampSessionRow } from "@/lib/camp/dto";
import { CampAiError } from "@/lib/camp/errors";

const SESSION_SELECT =
  "id, profile_id, character_id, started_at, last_message_at, message_count, is_open, created_at, updated_at";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * One continuing session per profile × character.
 * Race-safe via unique constraint: insert, on conflict reload winner.
 */
export async function getOrCreateCampSession(input: {
  profileId: string;
  characterId: string;
  admin?: SupabaseClient;
}): Promise<CampSessionRow> {
  const admin = input.admin ?? (await defaultAdmin());

  const existing = await findCampSession({
    profileId: input.profileId,
    characterId: input.characterId,
    admin,
  });
  if (existing) {
    if (!existing.is_open) {
      throw new CampAiError(
        "camp_session_closed",
        "Camp session is closed",
        403,
      );
    }
    return existing;
  }

  const { data, error } = await admin
    .from("camp_sessions")
    .insert({
      profile_id: input.profileId,
      character_id: input.characterId,
      is_open: true,
      message_count: 0,
    })
    .select(SESSION_SELECT)
    .single();

  if (!error && data) {
    return data as CampSessionRow;
  }

  if (error?.code === "23505") {
    const winner = await findCampSession({
      profileId: input.profileId,
      characterId: input.characterId,
      admin,
    });
    if (winner) {
      if (!winner.is_open) {
        throw new CampAiError(
          "camp_session_closed",
          "Camp session is closed",
          403,
        );
      }
      return winner;
    }
  }

  throw new CampAiError(
    "camp_write_failed",
    "Failed to open Camp session",
    500,
  );
}

export async function findCampSession(input: {
  profileId: string;
  characterId: string;
  admin?: SupabaseClient;
}): Promise<CampSessionRow | null> {
  const admin = input.admin ?? (await defaultAdmin());
  const { data, error } = await admin
    .from("camp_sessions")
    .select(SESSION_SELECT)
    .eq("profile_id", input.profileId)
    .eq("character_id", input.characterId)
    .maybeSingle();

  if (error) {
    throw new CampAiError("camp_write_failed", "Failed to load session", 500);
  }
  return (data as CampSessionRow | null) ?? null;
}

/**
 * Recompute message_count from persisted conversational rows.
 * Cache field — not economic authority. Avoids read→increment races.
 */
export async function refreshCampSessionCounters(
  sessionId: string,
  admin?: SupabaseClient,
): Promise<void> {
  const db = admin ?? (await defaultAdmin());
  const { count, error: countError } = await db
    .from("camp_messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .in("role", ["user", "assistant"]);

  if (countError) {
    throw new CampAiError(
      "camp_write_failed",
      "Failed to count Camp messages",
      500,
    );
  }

  const { data: latest, error: latestError } = await db
    .from("camp_messages")
    .select("created_at")
    .eq("session_id", sessionId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw new CampAiError(
      "camp_write_failed",
      "Failed to read latest Camp message",
      500,
    );
  }

  const { error: updateError } = await db
    .from("camp_sessions")
    .update({
      message_count: count ?? 0,
      last_message_at: latest?.created_at ?? null,
    })
    .eq("id", sessionId);

  if (updateError) {
    throw new CampAiError(
      "camp_write_failed",
      "Failed to update Camp session",
      500,
    );
  }
}
