import type { CampCharacterSlug, CampConversationRole } from "@/lib/camp/types";

/** Public character identity for Camp UI (no prompts). */
export type SafeCampCharacter = {
  slug: CampCharacterSlug;
  displayName: string;
};

/** Client-safe conversation message — no evaluation / private policy fields. */
export type SafeCampMessage = {
  id: string;
  role: CampConversationRole;
  content: string;
  createdAt: string;
  /** Actual LEAF granted on this turn. Omitted when 0. */
  rewardGranted?: number;
};

/** Actual Camp reward outcome only — never recommendations or scores. */
export type SafeCampReward = {
  granted: number;
};

export type SafeCampConversation = {
  character: SafeCampCharacter;
  messages: SafeCampMessage[];
  sessionStartedAt: string | null;
  lastMessageAt: string | null;
};

export type CampMessageRow = {
  id: string;
  session_id: string;
  profile_id: string;
  character_id: string;
  role: string;
  content: string;
  reward_recommendation: number | null;
  reward_granted: number;
  quality: number | null;
  originality: number | null;
  relevance: number | null;
  spam_probability: number | null;
  memory_candidate_flag: boolean;
  leaf_ledger_id: string | null;
  client_message_hash: string | null;
  moderation_flags: Record<string, unknown> | null;
  created_at: string;
};

export type CampSessionRow = {
  id: string;
  profile_id: string;
  character_id: string;
  started_at: string;
  last_message_at: string | null;
  message_count: number;
  is_open: boolean;
  created_at: string;
  updated_at: string;
};

export type CampCharacterRow = {
  id: string;
  slug: string;
  display_name: string;
  prompt_key: string | null;
  is_active: boolean;
  is_locked: boolean;
};

export function toSafeCampMessage(row: CampMessageRow): SafeCampMessage | null {
  if (row.role !== "user" && row.role !== "assistant") return null;
  const granted = Number(row.reward_granted ?? 0);
  const message: SafeCampMessage = {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
  if (row.role === "assistant" && granted > 0) {
    message.rewardGranted = granted;
  }
  return message;
}

export function toSafeCampReward(granted: number): SafeCampReward {
  return { granted: Math.max(0, Math.trunc(granted) || 0) };
}
