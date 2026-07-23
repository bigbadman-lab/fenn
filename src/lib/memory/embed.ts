import "server-only";

import {
  FENN_EMBEDDING_DIMENSIONS,
  FENN_EMBEDDING_MODEL,
} from "@/lib/memory/index-config";
import { MemoryIndexError } from "@/lib/memory/index-errors";

export type EmbeddingCaller = (input: {
  model: string;
  texts: string[];
}) => Promise<number[][]>;

function isTimeoutLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; code?: string; name?: string };
  return (
    e.status === 408 ||
    e.code === "timeout" ||
    e.name === "APIConnectionTimeoutError"
  );
}

function assertDimension(vector: number[]): void {
  if (vector.length !== FENN_EMBEDDING_DIMENSIONS) {
    throw new MemoryIndexError(
      "memory_embed_invalid_dimension",
      `Expected embedding dimension ${FENN_EMBEDDING_DIMENSIONS}, got ${vector.length}`,
      502,
    );
  }
}

async function defaultEmbeddingCaller(input: {
  model: string;
  texts: string[];
}): Promise<number[][]> {
  const { getOpenAIClient, OpenAIUnavailableError } = await import(
    "@/lib/ai/openai"
  );

  let client;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof OpenAIUnavailableError) {
      throw new MemoryIndexError(
        "memory_embed_unavailable",
        "Embedding API is not configured",
        503,
      );
    }
    throw error;
  }

  try {
    const response = await client.embeddings.create({
      model: input.model,
      input: input.texts,
    });

    const byIndex = new Map<number, number[]>();
    for (const row of response.data) {
      byIndex.set(row.index, row.embedding);
    }

    const vectors: number[][] = [];
    for (let i = 0; i < input.texts.length; i += 1) {
      const vector = byIndex.get(i);
      if (!vector) {
        throw new MemoryIndexError(
          "memory_embed_failed",
          "Embedding response missing vector",
          502,
        );
      }
      assertDimension(vector);
      vectors.push(vector);
    }
    return vectors;
  } catch (error) {
    if (error instanceof MemoryIndexError) throw error;
    if (isTimeoutLike(error)) {
      throw new MemoryIndexError(
        "memory_embed_timeout",
        "Embedding API timed out",
        504,
      );
    }
    throw new MemoryIndexError(
      "memory_embed_failed",
      "Embedding API failed",
      502,
    );
  }
}

/**
 * Embed one or more texts with the locked FENN embedding model.
 * Does not write to the database.
 */
export async function embedFennTexts(
  texts: string[],
  callEmbed?: EmbeddingCaller,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const caller = callEmbed ?? defaultEmbeddingCaller;
  return caller({
    model: FENN_EMBEDDING_MODEL,
    texts,
  });
}

export function formatEmbeddingForPg(vector: number[]): string {
  assertDimension(vector);
  return `[${vector.join(",")}]`;
}
