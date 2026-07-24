/**
 * Stage 11.6 Camp knowledge context budgets (single source of truth).
 */

/** Results requested from retrieveFennKnowledge for Camp. */
export const FENN_CAMP_RETRIEVE_LIMIT = 4;

/** Max total characters in the assembled knowledge reference block. */
export const FENN_CAMP_KNOWLEDGE_MAX_CHARS = 3500;

/** Max Canon entries kept in the Camp knowledge block. */
export const FENN_CAMP_MAX_CANON_CHUNKS = 3;

/** Max approved-memory entries kept in the Camp knowledge block. */
export const FENN_CAMP_MAX_MEMORY_CHUNKS = 2;

/** Max characters per individual chunk body inside the block. */
export const FENN_CAMP_MAX_CHUNK_CHARS = 900;

/** Soft timeout so retrieval cannot hang a Camp turn. */
export const FENN_CAMP_RETRIEVE_TIMEOUT_MS = 4000;
