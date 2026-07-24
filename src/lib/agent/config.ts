/**
 * Stage 11.7 public-agent knowledge budgets (stricter than Camp for X latency).
 */

/** Results requested from retrieveFennKnowledge for public_agent. */
export const FENN_PUBLIC_AGENT_RETRIEVE_LIMIT = 3;

/** Max total characters in the public knowledge reference block. */
export const FENN_PUBLIC_AGENT_KNOWLEDGE_MAX_CHARS = 2500;

/** Max Canon entries in the public-agent knowledge block. */
export const FENN_PUBLIC_AGENT_MAX_CANON_CHUNKS = 2;

/** Max public-memory entries in the public-agent knowledge block. */
export const FENN_PUBLIC_AGENT_MAX_MEMORY_CHUNKS = 1;

/** Max characters per individual chunk body. */
export const FENN_PUBLIC_AGENT_MAX_CHUNK_CHARS = 700;

/** Soft timeout so knowledge lookup cannot hang Stage 12. */
export const FENN_PUBLIC_AGENT_RETRIEVE_TIMEOUT_MS = 3500;
