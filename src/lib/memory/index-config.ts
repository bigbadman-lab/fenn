/**
 * Stage 11.4 embedding + chunking configuration (single source of truth).
 */

/** OpenAI embedding model for FENN knowledge chunks. */
export const FENN_EMBEDDING_MODEL = "text-embedding-3-small" as const;

/**
 * text-embedding-3-small native output size.
 * Locked to match extensions.vector(1536) in Stage 11.4 migration.
 * Not reduced via API dimensions parameter.
 */
export const FENN_EMBEDDING_DIMENSIONS = 1536 as const;

/**
 * Chunking / index version — bump to force full reindex when algorithm changes.
 */
export const FENN_CHUNKING_VERSION = "chunk-v1" as const;

/**
 * Soft target chunk size (characters). Prefer paragraph boundaries near this.
 * Short documents at or below MAX stay a single chunk.
 */
export const FENN_CHUNK_TARGET_CHARS = 800;

/** Hard maximum chunk size before forced split. */
export const FENN_CHUNK_MAX_CHARS = 1200;

/**
 * Overlap (characters) when a forced split occurs inside a long paragraph.
 * Modest overlap preserves boundary context without duplicating whole sections.
 */
export const FENN_CHUNK_OVERLAP_CHARS = 100;

/** Max memories processed per processPendingMemoryIndex / memory:index pass. */
export const FENN_INDEX_BATCH_DEFAULT = 25;
export const FENN_INDEX_BATCH_MAX = 100;

/**
 * Future Stage 11.5 distance: cosine (`<=>` / vector_cosine_ops).
 * No ANN index in 11.4 — corpus is small; exact scan is fine.
 */
export const FENN_VECTOR_DISTANCE = "cosine" as const;
