/**
 * Central Camp AI configuration (limits + model).
 * One place — do not scatter model strings.
 */

/** Stage 7.1 default: low cost, strong structured-output adherence, conversational. */
export const CAMP_OPENAI_MODEL = "gpt-4o-mini";

/** Last N user/assistant messages sent to the model (excluding the new user turn). */
export const CAMP_HISTORY_MESSAGE_LIMIT = 20;

/**
 * Max user/assistant messages returned to the Camp UI on load.
 * Older history remains in DB; UI does not paginate in Stage 7.2.
 */
export const CAMP_DISPLAY_MESSAGE_LIMIT = 50;

/** Max characters for a single user message (server-authoritative). */
export const CAMP_USER_MESSAGE_MAX_CHARS = 4000;

/**
 * Soft ceiling on assistant completion tokens.
 * Favours compact Camp dialogue without forcing one-liners.
 */
export const CAMP_MAX_COMPLETION_TOKENS = 500;

/** Conservative reward recommendation range (recommendation only — not LEAF grant). */
export const CAMP_REWARD_RECOMMENDATION_MAX = 3;

/** Spec-aligned integer scales for contribution dimensions. */
export const CAMP_SCORE_MIN = 0;
export const CAMP_SCORE_MAX = 3;

/** Prior USER messages compared for repetition (same character session). */
export const CAMP_REPETITION_LOOKBACK = 10;

/**
 * Jaccard token similarity at/above this forces reward recommendation 0.
 * Exact normalized match always counts as repetition.
 */
export const CAMP_REPETITION_SIMILARITY_THRESHOLD = 0.9;

/** Minimum spamProbability when repetition or farming is detected. */
export const CAMP_SPAM_FLOOR_ON_SIGNAL = 0.8;

/**
 * Static empty-state lines (not persisted assistant messages).
 * Safe for client import — no prompts/secrets.
 */
export const CAMP_EMPTY_CONVERSATION_PROMPTS = {
  fenn: "say something worth carrying.",
  wren: "speak. she is listening.",
  rook: "what did you see?",
} as const;

/**
 * Suggested minimum interval between Camp AI sends (cost protection).
 * Not enforced in Stage 7 — requires distributed rate limiting (Stage 14).
 * Distinct from Camp reward cooldown (60s).
 */
export const CAMP_SEND_MIN_INTERVAL_SECONDS_DEFERRED = 2;
