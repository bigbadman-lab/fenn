/**
 * Stage 11.3 autonomous memory review configuration.
 */

/** Same stack as Camp — structured classification + concise rewrite. */
export const MEMORY_REVIEW_OPENAI_MODEL = "gpt-4o-mini";

export const MEMORY_REVIEW_MAX_COMPLETION_TOKENS = 400;

export const MEMORY_REVIEW_ACTOR_ID = "system:memory-reviewer" as const;

export const MEMORY_REVIEW_PROMPT_VERSION = "memory-review-v1" as const;

/** Default backlog batch size for processPendingMemoryCandidates. */
export const MEMORY_REVIEW_PENDING_BATCH_DEFAULT = 20;

export const MEMORY_REVIEW_PENDING_BATCH_MAX = 50;

export const MEMORY_APPROVE_REASON_CODES = [
  "durable_observation",
  "useful_context",
] as const;

export const MEMORY_DISCARD_REASON_CODES = [
  "instructional_content",
  "personal_data",
  "temporary_state",
  "low_value",
  "unsafe",
  "duplicate",
  "canon_rewrite",
] as const;

export const MEMORY_REVIEW_REASON_CODES = [
  ...MEMORY_APPROVE_REASON_CODES,
  ...MEMORY_DISCARD_REASON_CODES,
] as const;

export type MemoryReviewReasonCode =
  (typeof MEMORY_REVIEW_REASON_CODES)[number];
