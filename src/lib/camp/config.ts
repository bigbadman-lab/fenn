/**
 * Central Camp AI configuration (limits + model).
 * One place — do not scatter model strings.
 */

/** Stage 7.1 default: low cost, strong structured-output adherence, conversational. */
export const CAMP_OPENAI_MODEL = "gpt-4o-mini";

/** Last N user/assistant messages sent to the model (excluding the new user turn). */
export const CAMP_HISTORY_MESSAGE_LIMIT = 20;

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
