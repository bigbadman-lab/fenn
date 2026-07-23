import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildChunkEmbeddingInput,
  chunkFennMemoryContent,
  hashChunkContent,
  memoryIndexFingerprint,
} from "@/lib/memory/chunking";
import { embedFennTexts, formatEmbeddingForPg, type EmbeddingCaller } from "@/lib/memory/embed";
import {
  FENN_CHUNKING_VERSION,
  FENN_EMBEDDING_MODEL,
} from "@/lib/memory/index-config";
import { MemoryIndexError } from "@/lib/memory/index-errors";

export type IndexableMemoryRow = {
  id: string;
  layer: string;
  title: string | null;
  content: string;
  is_active: boolean;
  visibility: string;
};

export type IndexFennMemoryResult =
  | { status: "indexed"; memoryId: string; chunkCount: number }
  | { status: "unchanged"; memoryId: string; chunkCount: number }
  | { status: "cleared"; memoryId: string }
  | { status: "skipped"; memoryId: string; reason: string };

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export async function loadIndexableMemory(
  memoryId: string,
  admin: SupabaseClient,
): Promise<IndexableMemoryRow | null> {
  const { data, error } = await admin
    .from("fenn_memories")
    .select("id, layer, title, content, is_active, visibility")
    .eq("id", memoryId)
    .maybeSingle();

  if (error) {
    throw new MemoryIndexError(
      "memory_index_failed",
      "Failed to load memory for indexing",
      500,
    );
  }
  return (data as IndexableMemoryRow | null) ?? null;
}

async function listChunkFingerprints(
  memoryId: string,
  admin: SupabaseClient,
): Promise<{ count: number; fingerprint: string | null }> {
  const { data, error } = await admin
    .from("fenn_memory_chunks")
    .select("source_fingerprint, embedding_model, chunking_version")
    .eq("memory_id", memoryId)
    .order("chunk_index", { ascending: true });

  if (error) {
    throw new MemoryIndexError(
      "memory_index_failed",
      "Failed to load existing chunks",
      500,
    );
  }

  const rows = (data ?? []) as Array<{
    source_fingerprint: string;
    embedding_model: string;
    chunking_version: string;
  }>;

  if (rows.length === 0) return { count: 0, fingerprint: null };

  const fingerprint = rows[0]?.source_fingerprint ?? null;
  const uniform = rows.every(
    (r) =>
      r.source_fingerprint === fingerprint &&
      r.embedding_model === FENN_EMBEDDING_MODEL &&
      r.chunking_version === FENN_CHUNKING_VERSION,
  );
  if (!uniform) return { count: rows.length, fingerprint: null };
  return { count: rows.length, fingerprint };
}

async function clearChunks(
  memoryId: string,
  admin: SupabaseClient,
): Promise<void> {
  const { error } = await admin.rpc("clear_fenn_memory_chunks", {
    p_memory_id: memoryId,
  });
  if (error) {
    throw new MemoryIndexError(
      "memory_index_failed",
      "Failed to clear memory chunks",
      500,
    );
  }
}

/**
 * Index (or clear) one fenn_memory into derived chunks + embeddings.
 * Never mutates the source memory row.
 */
export async function indexFennMemory(input: {
  memoryId: string;
  admin?: SupabaseClient;
  callEmbed?: EmbeddingCaller;
  force?: boolean;
}): Promise<IndexFennMemoryResult> {
  const admin = input.admin ?? (await defaultAdmin());
  const memory = await loadIndexableMemory(input.memoryId, admin);
  if (!memory) {
    throw new MemoryIndexError(
      "memory_index_not_found",
      "Memory not found",
      404,
    );
  }

  if (!memory.is_active || !["canon", "greenwood_memory"].includes(memory.layer)) {
    await clearChunks(memory.id, admin);
    return { status: "cleared", memoryId: memory.id };
  }

  const fingerprint = memoryIndexFingerprint({
    title: memory.title,
    content: memory.content,
  });

  const existing = await listChunkFingerprints(memory.id, admin);
  const drafts = chunkFennMemoryContent({
    title: memory.title,
    content: memory.content,
  });

  if (drafts.length === 0) {
    await clearChunks(memory.id, admin);
    return { status: "cleared", memoryId: memory.id };
  }

  if (
    !input.force &&
    existing.fingerprint === fingerprint &&
    existing.count === drafts.length
  ) {
    return {
      status: "unchanged",
      memoryId: memory.id,
      chunkCount: existing.count,
    };
  }

  const embedInputs = drafts.map((d) =>
    buildChunkEmbeddingInput(memory.title, d.content),
  );

  // External API outside DB transaction.
  const vectors = await embedFennTexts(embedInputs, input.callEmbed);

  // Optimistic consistency: parent must not have changed during embed.
  const fresh = await loadIndexableMemory(memory.id, admin);
  if (!fresh || !fresh.is_active) {
    return { status: "skipped", memoryId: memory.id, reason: "inactive" };
  }
  const freshFingerprint = memoryIndexFingerprint({
    title: fresh.title,
    content: fresh.content,
  });
  if (freshFingerprint !== fingerprint) {
    throw new MemoryIndexError(
      "memory_index_stale_parent",
      "Memory changed during embedding; retry later",
      409,
    );
  }

  const payload = drafts.map((d, i) => ({
    chunk_index: d.chunkIndex,
    content: d.content,
    embedding: formatEmbeddingForPg(vectors[i]!),
    content_hash: hashChunkContent(d.content),
    embedding_model: FENN_EMBEDDING_MODEL,
    chunking_version: FENN_CHUNKING_VERSION,
  }));

  const { data, error } = await admin.rpc("replace_fenn_memory_chunks", {
    p_memory_id: memory.id,
    p_expected_fingerprint: fingerprint,
    p_chunks: payload,
  });

  if (error) {
    throw new MemoryIndexError(
      "memory_index_failed",
      error.message ?? "Failed to replace memory chunks",
      500,
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    replaced?: boolean;
    chunk_count?: number;
  } | null;

  return {
    status: "indexed",
    memoryId: memory.id,
    chunkCount: row?.chunk_count ?? payload.length,
  };
}

/**
 * Best-effort index after durable memory approval.
 * Failures never undo approval.
 */
export async function bestEffortIndexFennMemory(
  memoryId: string,
  admin?: SupabaseClient,
  callEmbed?: EmbeddingCaller,
): Promise<void> {
  try {
    await indexFennMemory({ memoryId, admin, callEmbed });
  } catch {
    // Intentionally swallowed — backlog processor retries.
  }
}
