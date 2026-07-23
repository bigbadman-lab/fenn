/**
 * Stage 11.5 retrieval ranking + pool constants (single source of truth).
 */

/** Semantic candidate pool size before hybrid ranking / diversity. */
export const FENN_RETRIEVE_CANDIDATE_POOL = 20;

/** Default final result count. */
export const FENN_RETRIEVE_LIMIT_DEFAULT = 5;

/** Hard cap on caller-requested limit. */
export const FENN_RETRIEVE_LIMIT_MAX = 10;

/** Maximum accepted query length (characters). */
export const FENN_RETRIEVE_QUERY_MAX_CHARS = 500;

/**
 * Minimum hybrid score to include a result.
 * Below this → omit (empty array is valid when nothing is relevant).
 */
export const FENN_RETRIEVE_MIN_HYBRID_SCORE = 0.32;

/** Weight of cosine similarity in hybrid score. */
export const FENN_RETRIEVE_SEMANTIC_WEIGHT = 0.65;

/** Weight of lexical overlap in hybrid score. */
export const FENN_RETRIEVE_LEXICAL_WEIGHT = 0.2;

/**
 * Additive Canon authority boost (not a hard always-first rule).
 * Perfect memory can still beat weakly relevant Canon.
 */
export const FENN_RETRIEVE_CANON_AUTHORITY_BOOST = 0.15;

/** Max chunks retained per parent memory in the final set. */
export const FENN_RETRIEVE_MAX_CHUNKS_PER_MEMORY = 2;

/**
 * Lexical search uses PostgreSQL `simple` config (no English stemming)
 * so FENN terms (LEAF, FENN, Greenwood, …) stay exact.
 * Ranking still applies a deterministic app-side token overlap over the
 * semantic candidate pool for testability.
 */
export const FENN_RETRIEVE_FTS_CONFIG = "simple" as const;
