import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { embedFennTexts, formatEmbeddingForPg } from "@/lib/memory/embed";
import type { EmbeddingCaller } from "@/lib/memory/embed";
import { MemoryIndexError } from "@/lib/memory/index-errors";
import {
  FENN_RETRIEVE_CANDIDATE_POOL,
  FENN_RETRIEVE_LIMIT_DEFAULT,
  FENN_RETRIEVE_LIMIT_MAX,
  FENN_RETRIEVE_QUERY_MAX_CHARS,
} from "@/lib/memory/retrieve-config";
import { MemoryRetrieveError } from "@/lib/memory/retrieve-errors";
import {
  rankRetrieveCandidates,
  type RetrievalLayer,
} from "@/lib/memory/retrieve-rank";
import {
  parseFennKnowledgeScope,
  scopeAllowsVisibility,
  type FennKnowledgeScope,
} from "@/lib/memory/retrieve-scope";

export type { FennKnowledgeScope };

export type RetrieveFennKnowledgeInput = {
  query: string;
  scope: FennKnowledgeScope;
  /** Final result count (capped). Default 5. */
  limit?: number;
  admin?: SupabaseClient;
  callEmbed?: EmbeddingCaller;
};

/**
 * Narrow retrieval DTO — no embeddings, no provenance, no audit fields.
 */
export type RetrievedFennKnowledge = {
  memoryId: string;
  layer: RetrievalLayer;
  title: string;
  text: string;
  chunkIndex: number;
  /** Hybrid score for internal/tests — not a public API field for Stage 12 UI. */
  score: number;
  visibility: "public" | "camp" | "internal";
};

type SearchChunkRow = {
  memory_id: string;
  chunk_index: number;
  content: string;
  title: string | null;
  layer: string;
  visibility: string;
  cosine_distance: number;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function validateQuery(raw: string): string {
  if (typeof raw !== "string") {
    throw new MemoryRetrieveError(
      "memory_retrieve_invalid_query",
      "Query must be a string",
      400,
    );
  }
  const query = raw.trim();
  if (query.length === 0) {
    throw new MemoryRetrieveError(
      "memory_retrieve_invalid_query",
      "Query must not be empty",
      400,
    );
  }
  if (query.length > FENN_RETRIEVE_QUERY_MAX_CHARS) {
    throw new MemoryRetrieveError(
      "memory_retrieve_invalid_query",
      `Query exceeds ${FENN_RETRIEVE_QUERY_MAX_CHARS} characters`,
      400,
    );
  }
  return query;
}

function validateLimit(raw: number | undefined): number {
  if (raw === undefined) return FENN_RETRIEVE_LIMIT_DEFAULT;
  if (!Number.isFinite(raw) || raw < 1) {
    throw new MemoryRetrieveError(
      "memory_retrieve_invalid_limit",
      "Limit must be a positive integer",
      400,
    );
  }
  return Math.min(Math.floor(raw), FENN_RETRIEVE_LIMIT_MAX);
}

function isRetrievalLayer(layer: string): layer is RetrievalLayer {
  return layer === "canon" || layer === "greenwood_memory";
}

function isVisibility(
  v: string,
): v is "public" | "camp" | "internal" {
  return v === "public" || v === "camp" || v === "internal";
}

/**
 * Trusted server-only knowledge retrieval.
 * Does not mutate DB. Does not inject into prompts (Stage 11.6).
 */
export async function retrieveFennKnowledge(
  input: RetrieveFennKnowledgeInput,
): Promise<RetrievedFennKnowledge[]> {
  const query = validateQuery(input.query);
  const scope = parseFennKnowledgeScope(input.scope);
  const limit = validateLimit(input.limit);
  const admin = input.admin ?? (await defaultAdmin());

  let vectors: number[][];
  try {
    vectors = await embedFennTexts([query], input.callEmbed);
  } catch (error) {
    if (error instanceof MemoryIndexError) {
      throw new MemoryRetrieveError(
        "memory_retrieve_embed_failed",
        error.message,
        error.status,
      );
    }
    throw new MemoryRetrieveError(
      "memory_retrieve_embed_failed",
      "Query embedding failed",
      502,
    );
  }

  const embedding = formatEmbeddingForPg(vectors[0]!);

  const { data, error } = await admin.rpc("search_fenn_memory_chunks", {
    p_query_embedding: embedding,
    p_scope: scope,
    p_limit: FENN_RETRIEVE_CANDIDATE_POOL,
  });

  if (error) {
    throw new MemoryRetrieveError(
      "memory_retrieve_failed",
      error.message ?? "Knowledge search failed",
      500,
    );
  }

  const rows = (data ?? []) as SearchChunkRow[];

  // Defence in depth: re-apply scope visibility in application code.
  const candidates = rows
    .filter((row) => {
      if (!isRetrievalLayer(row.layer)) return false;
      if (!isVisibility(row.visibility)) return false;
      if (!scopeAllowsVisibility(scope, row.visibility)) return false;
      return typeof row.content === "string" && row.content.trim().length > 0;
    })
    .map((row) => ({
      memoryId: row.memory_id,
      layer: row.layer as RetrievalLayer,
      title: row.title,
      text: row.content,
      chunkIndex: row.chunk_index,
      visibility: row.visibility,
      cosineDistance: Number(row.cosine_distance),
    }));

  const ranked = rankRetrieveCandidates({
    query,
    candidates,
    limit,
  });

  return ranked.map((r) => ({
    memoryId: r.memoryId,
    layer: r.layer,
    title: r.title,
    text: r.text,
    chunkIndex: r.chunkIndex,
    score: r.score,
    visibility: r.visibility as "public" | "camp" | "internal",
  }));
}
