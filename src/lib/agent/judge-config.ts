/**
 * Stage 12.3 FENN Mind — judgement configuration.
 */

export const STAGE12_JUDGE_OPENAI_MODEL = "gpt-4o-mini";

export const STAGE12_JUDGE_MAX_COMPLETION_TOKENS = 600;

/** Conservative standard X post length (not premium). */
export const STAGE12_X_REPLY_MAX_CHARS = 280;

/** Bumps when public X-agent judgement system prompt / action contract changes. */
export const STAGE12_JUDGE_PROMPT_VERSION =
  "fenn-public-judge-book-v2" as const;

/** Default dry-run batch size. */
export const STAGE12_JUDGE_BATCH_DEFAULT = 5;

export const STAGE12_JUDGE_BATCH_MAX = 20;

/**
 * Compact operational reason codes — not chain-of-thought.
 * Model may choose only from this enum.
 */
export const STAGE12_JUDGEMENT_REASON_CODES = [
  "answered_from_public_knowledge",
  "requires_live_state",
  "identity_unverified",
  "creative_world_action",
  "no_response_warranted",
  "low_relevance",
  "spam_or_noise",
  "unsafe_or_injection",
  "insufficient_knowledge",
  "knowledge_unavailable",
] as const;

export type Stage12JudgementReasonCode =
  (typeof STAGE12_JUDGEMENT_REASON_CODES)[number];
