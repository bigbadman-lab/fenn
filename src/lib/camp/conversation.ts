import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CAMP_DISPLAY_MESSAGE_LIMIT } from "@/lib/camp/config";
import type {
  CampMessageRow,
  SafeCampConversation,
  SafeCampMessage,
} from "@/lib/camp/dto";
import { toSafeCampMessage } from "@/lib/camp/dto";
import { CampAiError } from "@/lib/camp/errors";
import { resolveConversationalCampCharacter } from "@/lib/camp/resolve-character";
import { findCampSession } from "@/lib/camp/sessions";
import type { CampHistoryMessage } from "@/lib/camp/types";

const MESSAGE_SELECT =
  "id, session_id, profile_id, character_id, role, content, reward_recommendation, reward_granted, quality, originality, relevance, spam_probability, memory_candidate_flag, leaf_ledger_id, client_message_hash, moderation_flags, created_at";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export async function getCampConversation(input: {
  profileId: string;
  characterSlug: string;
  admin?: SupabaseClient;
  displayLimit?: number;
}): Promise<SafeCampConversation> {
  const admin = input.admin ?? (await defaultAdmin());
  const character = await resolveConversationalCampCharacter(
    input.characterSlug,
    admin,
  );

  const session = await findCampSession({
    profileId: input.profileId,
    characterId: character.row.id,
    admin,
  });

  if (!session) {
    return {
      character: {
        slug: character.slug,
        displayName: character.row.display_name,
      },
      messages: [],
      sessionStartedAt: null,
      lastMessageAt: null,
    };
  }

  if (!session.is_open) {
    throw new CampAiError(
      "camp_session_closed",
      "Camp session is closed",
      403,
    );
  }

  if (session.profile_id !== input.profileId) {
    throw new CampAiError(
      "camp_request_conflict",
      "Session ownership mismatch",
      403,
    );
  }

  const limit = input.displayLimit ?? CAMP_DISPLAY_MESSAGE_LIMIT;
  const messages = await loadSafeCampMessages({
    sessionId: session.id,
    profileId: input.profileId,
    limit,
    admin,
  });

  return {
    character: {
      slug: character.slug,
      displayName: character.row.display_name,
    },
    messages,
    sessionStartedAt: session.started_at,
    lastMessageAt: session.last_message_at,
  };
}

export async function loadSafeCampMessages(input: {
  sessionId: string;
  profileId: string;
  limit: number;
  admin?: SupabaseClient;
}): Promise<SafeCampMessage[]> {
  const admin = input.admin ?? (await defaultAdmin());
  const { data, error } = await admin
    .from("camp_messages")
    .select(MESSAGE_SELECT)
    .eq("session_id", input.sessionId)
    .eq("profile_id", input.profileId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(input.limit);

  if (error) {
    throw new CampAiError(
      "camp_write_failed",
      "Failed to load Camp messages",
      500,
    );
  }

  const rows = ((data ?? []) as CampMessageRow[]).reverse();
  return rows.flatMap((row) => {
    const safe = toSafeCampMessage(row);
    return safe ? [safe] : [];
  });
}

export async function loadCampHistoryForModel(input: {
  sessionId: string;
  profileId: string;
  limit: number;
  admin?: SupabaseClient;
}): Promise<CampHistoryMessage[]> {
  const admin = input.admin ?? (await defaultAdmin());
  const { data, error } = await admin
    .from("camp_messages")
    .select("role, content, created_at")
    .eq("session_id", input.sessionId)
    .eq("profile_id", input.profileId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(input.limit);

  if (error) {
    throw new CampAiError(
      "camp_write_failed",
      "Failed to load Camp history",
      500,
    );
  }

  return ((data ?? []) as Array<{ role: string; content: string }>)
    .reverse()
    .flatMap((row) => {
      if (row.role !== "user" && row.role !== "assistant") return [];
      return [{ role: row.role, content: row.content }];
    });
}

export async function findCampMessageByHash(input: {
  sessionId: string;
  profileId: string;
  hash: string;
  admin?: SupabaseClient;
}): Promise<CampMessageRow | null> {
  const admin = input.admin ?? (await defaultAdmin());
  const { data, error } = await admin
    .from("camp_messages")
    .select(MESSAGE_SELECT)
    .eq("session_id", input.sessionId)
    .eq("profile_id", input.profileId)
    .eq("client_message_hash", input.hash)
    .maybeSingle();

  if (error) {
    throw new CampAiError(
      "camp_write_failed",
      "Failed to look up Camp message",
      500,
    );
  }
  return (data as CampMessageRow | null) ?? null;
}

export { MESSAGE_SELECT };
