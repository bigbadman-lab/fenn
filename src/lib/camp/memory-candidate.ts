import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { MESSAGE_SELECT, findCampMessageByHash } from "@/lib/camp/conversation";
import type { CampMessageRow } from "@/lib/camp/dto";
import { CampAiError } from "@/lib/camp/errors";
import {
  campRequestHashes,
  isCampClientMessageId,
} from "@/lib/camp/hash";

export type MemoryCandidateRow = {
  id: string;
  profile_id: string;
  character_id: string | null;
  camp_message_id: string | null;
  content: string;
  status: string;
  resulting_memory_id: string | null;
  created_at: string;
};

export type CreateMemoryCandidateResult = {
  created: boolean;
  skipped: boolean;
  reason:
    | "created"
    | "already_exists"
    | "not_flagged"
    | "not_assistant"
    | "missing_message"
    | "pairing_failed"
    | "empty_content";
  candidate: MemoryCandidateRow | null;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Create a pending memory_candidates row from an evaluated assistant Camp message.
 * Content is the paired USER contribution (Stage 7.2 hash pairing).
 * Never writes fenn_memories. Never auto-approves.
 */
export async function createMemoryCandidateFromCampMessage(input: {
  messageId: string;
  admin?: SupabaseClient;
}): Promise<CreateMemoryCandidateResult> {
  const admin = input.admin ?? (await defaultAdmin());

  const { data, error } = await admin
    .from("camp_messages")
    .select(MESSAGE_SELECT)
    .eq("id", input.messageId)
    .maybeSingle();

  if (error) {
    throw new CampAiError(
      "camp_write_failed",
      "Failed to load Camp message for memory candidate",
      500,
    );
  }

  if (!data) {
    return {
      created: false,
      skipped: true,
      reason: "missing_message",
      candidate: null,
    };
  }

  const assistant = data as CampMessageRow;
  if (assistant.role !== "assistant") {
    return {
      created: false,
      skipped: true,
      reason: "not_assistant",
      candidate: null,
    };
  }

  if (!assistant.memory_candidate_flag) {
    return {
      created: false,
      skipped: true,
      reason: "not_flagged",
      candidate: null,
    };
  }

  const existing = await findCandidateByCampMessageId(admin, assistant.id);
  if (existing) {
    return {
      created: false,
      skipped: false,
      reason: "already_exists",
      candidate: existing,
    };
  }

  const userMessage = await resolvePairedUserContribution({
    assistant,
    admin,
  });
  if (!userMessage) {
    return {
      created: false,
      skipped: true,
      reason: "pairing_failed",
      candidate: null,
    };
  }

  const content = userMessage.content.trim();
  if (!content) {
    return {
      created: false,
      skipped: true,
      reason: "empty_content",
      candidate: null,
    };
  }

  const { data: inserted, error: insertError } = await admin
    .from("memory_candidates")
    .insert({
      profile_id: assistant.profile_id,
      character_id: assistant.character_id,
      camp_message_id: assistant.id,
      content,
      status: "pending",
      resulting_memory_id: null,
    })
    .select(
      "id, profile_id, character_id, camp_message_id, content, status, resulting_memory_id, created_at",
    )
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const raced = await findCandidateByCampMessageId(admin, assistant.id);
      if (raced) {
        return {
          created: false,
          skipped: false,
          reason: "already_exists",
          candidate: raced,
        };
      }
    }
    throw new CampAiError(
      "camp_write_failed",
      "Failed to create memory candidate",
      500,
    );
  }

  return {
    created: true,
    skipped: false,
    reason: "created",
    candidate: inserted as MemoryCandidateRow,
  };
}

async function findCandidateByCampMessageId(
  admin: SupabaseClient,
  campMessageId: string,
): Promise<MemoryCandidateRow | null> {
  const { data, error } = await admin
    .from("memory_candidates")
    .select(
      "id, profile_id, character_id, camp_message_id, content, status, resulting_memory_id, created_at",
    )
    .eq("camp_message_id", campMessageId)
    .maybeSingle();

  if (error) {
    throw new CampAiError(
      "camp_write_failed",
      "Failed to look up memory candidate",
      500,
    );
  }
  return (data as MemoryCandidateRow | null) ?? null;
}

/**
 * Pair assistant → user via Stage 7.2 clientMessageId hashes.
 * Requires moderation_flags.clientMessageId stored at insert time.
 */
export async function resolvePairedUserContribution(input: {
  assistant: CampMessageRow;
  admin: SupabaseClient;
}): Promise<CampMessageRow | null> {
  const flags = input.assistant.moderation_flags ?? {};
  const clientMessageIdRaw = flags.clientMessageId;
  const clientMessageId =
    typeof clientMessageIdRaw === "string" ? clientMessageIdRaw.trim() : "";

  if (!isCampClientMessageId(clientMessageId)) {
    return null;
  }

  const { userHash, assistantHash } = campRequestHashes({
    profileId: input.assistant.profile_id,
    sessionId: input.assistant.session_id,
    clientMessageId,
  });

  if (
    input.assistant.client_message_hash &&
    input.assistant.client_message_hash !== assistantHash
  ) {
    return null;
  }

  const user = await findCampMessageByHash({
    sessionId: input.assistant.session_id,
    profileId: input.assistant.profile_id,
    hash: userHash,
    admin: input.admin,
  });

  if (!user || user.role !== "user") return null;
  if (user.character_id !== input.assistant.character_id) return null;
  return user;
}
