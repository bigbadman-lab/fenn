import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { memoryIndexFingerprint } from "@/lib/memory/chunking";
import type { EmbeddingCaller } from "@/lib/memory/embed";
import {
  FENN_CHUNKING_VERSION,
  FENN_EMBEDDING_MODEL,
  FENN_INDEX_BATCH_DEFAULT,
  FENN_INDEX_BATCH_MAX,
} from "@/lib/memory/index-config";
import { MemoryIndexError } from "@/lib/memory/index-errors";
import {
  indexFennMemory,
  type IndexFennMemoryResult,
} from "@/lib/memory/index-memory";

export type ProcessPendingIndexResult = {
  scanned: number;
  indexed: number;
  unchanged: number;
  cleared: number;
  skipped: number;
  failed: number;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type MemoryListRow = {
  id: string;
  layer: string;
  title: string | null;
  content: string;
  is_active: boolean;
};

async function memoryNeedsIndex(
  memory: MemoryListRow,
  admin: SupabaseClient,
): Promise<boolean> {
  const fingerprint = memoryIndexFingerprint({
    title: memory.title,
    content: memory.content,
  });

  const { data, error } = await admin
    .from("fenn_memory_chunks")
    .select("source_fingerprint, embedding_model, chunking_version")
    .eq("memory_id", memory.id);

  if (error) {
    throw new MemoryIndexError(
      "memory_index_failed",
      "Failed to inspect chunk state",
      500,
    );
  }

  const rows = (data ?? []) as Array<{
    source_fingerprint: string;
    embedding_model: string;
    chunking_version: string;
  }>;

  if (!memory.is_active) {
    return rows.length > 0;
  }

  if (rows.length === 0) return true;

  return rows.some(
    (r) =>
      r.source_fingerprint !== fingerprint ||
      r.embedding_model !== FENN_EMBEDDING_MODEL ||
      r.chunking_version !== FENN_CHUNKING_VERSION,
  );
}

/**
 * Process active memories that need indexing (or inactive leftovers).
 */
export async function processPendingMemoryIndex(input?: {
  limit?: number;
  admin?: SupabaseClient;
  callEmbed?: EmbeddingCaller;
  force?: boolean;
}): Promise<ProcessPendingIndexResult> {
  const admin = input?.admin ?? (await defaultAdmin());
  const requested = input?.limit ?? FENN_INDEX_BATCH_DEFAULT;
  const limit = Math.min(
    Math.max(1, Math.floor(requested)),
    FENN_INDEX_BATCH_MAX,
  );

  const { data, error } = await admin
    .from("fenn_memories")
    .select("id, layer, title, content, is_active")
    .in("layer", ["canon", "greenwood_memory"])
    .order("updated_at", { ascending: true })
    .limit(Math.max(limit * 4, 50));

  if (error) {
    throw new MemoryIndexError(
      "memory_index_failed",
      "Failed to list memories for indexing",
      500,
    );
  }

  const candidates = (data ?? []) as MemoryListRow[];
  const toProcess: MemoryListRow[] = [];

  for (const memory of candidates) {
    if (toProcess.length >= limit) break;
    if (input?.force || (await memoryNeedsIndex(memory, admin))) {
      toProcess.push(memory);
    }
  }

  const summary: ProcessPendingIndexResult = {
    scanned: toProcess.length,
    indexed: 0,
    unchanged: 0,
    cleared: 0,
    skipped: 0,
    failed: 0,
  };

  for (const memory of toProcess) {
    try {
      const result: IndexFennMemoryResult = await indexFennMemory({
        memoryId: memory.id,
        admin,
        callEmbed: input?.callEmbed,
        force: input?.force,
      });
      if (result.status === "indexed") summary.indexed += 1;
      else if (result.status === "unchanged") summary.unchanged += 1;
      else if (result.status === "cleared") summary.cleared += 1;
      else summary.skipped += 1;
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}
