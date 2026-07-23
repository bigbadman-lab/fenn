import {
  FENN_RETRIEVE_CANON_AUTHORITY_BOOST,
  FENN_RETRIEVE_LEXICAL_WEIGHT,
  FENN_RETRIEVE_MAX_CHUNKS_PER_MEMORY,
  FENN_RETRIEVE_MIN_HYBRID_SCORE,
  FENN_RETRIEVE_SEMANTIC_WEIGHT,
} from "@/lib/memory/retrieve-config";

export type RetrievalLayer = "canon" | "greenwood_memory";

export type RankableCandidate = {
  memoryId: string;
  layer: RetrievalLayer;
  title: string | null;
  text: string;
  chunkIndex: number;
  visibility: string;
  /** pgvector cosine distance (`<=>`); lower is closer. */
  cosineDistance: number;
};

export type RankedKnowledge = {
  memoryId: string;
  layer: RetrievalLayer;
  title: string;
  text: string;
  chunkIndex: number;
  visibility: string;
  score: number;
  semanticScore: number;
  lexicalScore: number;
};

/** Tokenise for lexical overlap — lowercase, alphanumeric + underscore runs. */
export function tokenizeForLexical(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[a-z0-9_]+/g)
    ?.filter((t) => t.length > 0) ?? [];
}

/**
 * Lexical relevance in [0, 1]: fraction of unique query tokens present in
 * title+chunk (coverage). Empty query tokens → 0.
 */
export function lexicalOverlapScore(
  query: string,
  title: string | null | undefined,
  chunkText: string,
): number {
  const qTokens = [...new Set(tokenizeForLexical(query))];
  if (qTokens.length === 0) return 0;

  const hay = new Set(
    tokenizeForLexical(`${title ?? ""}\n${chunkText}`),
  );
  let hit = 0;
  for (const t of qTokens) {
    if (hay.has(t)) hit += 1;
  }
  return hit / qTokens.length;
}

/**
 * Convert pgvector cosine distance to similarity in [0, 1].
 * OpenAI embeddings are approximately unit-length; distance ≈ 1 − cos_sim.
 */
export function cosineDistanceToSimilarity(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return Math.max(0, Math.min(1, 1 - distance));
}

/**
 * hybridScore =
 *   semanticScore * SEMANTIC_WEIGHT
 * + lexicalScore * LEXICAL_WEIGHT
 * + (layer === canon ? CANON_AUTHORITY_BOOST : 0)
 */
export function hybridScore(input: {
  semanticScore: number;
  lexicalScore: number;
  layer: RetrievalLayer;
}): number {
  const authority =
    input.layer === "canon" ? FENN_RETRIEVE_CANON_AUTHORITY_BOOST : 0;
  return (
    input.semanticScore * FENN_RETRIEVE_SEMANTIC_WEIGHT +
    input.lexicalScore * FENN_RETRIEVE_LEXICAL_WEIGHT +
    authority
  );
}

/**
 * Rank candidates, apply threshold, per-memory diversity, and final limit.
 * Deterministic: score desc, then memoryId, then chunkIndex.
 */
export function rankRetrieveCandidates(input: {
  query: string;
  candidates: RankableCandidate[];
  limit: number;
  minScore?: number;
  maxChunksPerMemory?: number;
}): RankedKnowledge[] {
  const minScore = input.minScore ?? FENN_RETRIEVE_MIN_HYBRID_SCORE;
  const maxPer =
    input.maxChunksPerMemory ?? FENN_RETRIEVE_MAX_CHUNKS_PER_MEMORY;

  const scored: RankedKnowledge[] = input.candidates.map((c) => {
    const semanticScore = cosineDistanceToSimilarity(c.cosineDistance);
    const lexicalScore = lexicalOverlapScore(input.query, c.title, c.text);
    const score = hybridScore({
      semanticScore,
      lexicalScore,
      layer: c.layer,
    });
    return {
      memoryId: c.memoryId,
      layer: c.layer,
      title: (c.title ?? "").trim() || "(untitled)",
      text: c.text,
      chunkIndex: c.chunkIndex,
      visibility: c.visibility,
      score,
      semanticScore,
      lexicalScore,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.memoryId !== b.memoryId) return a.memoryId.localeCompare(b.memoryId);
    return a.chunkIndex - b.chunkIndex;
  });

  const perMemory = new Map<string, number>();
  const out: RankedKnowledge[] = [];

  for (const row of scored) {
    if (row.score < minScore) continue;
    const used = perMemory.get(row.memoryId) ?? 0;
    if (used >= maxPer) continue;
    perMemory.set(row.memoryId, used + 1);
    out.push(row);
    if (out.length >= input.limit) break;
  }

  return out;
}
