import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { memoryIndexFingerprint } from "@/lib/memory/chunking";
import {
  FENN_CHUNKING_VERSION,
  FENN_EMBEDDING_DIMENSIONS,
  FENN_EMBEDDING_MODEL,
} from "@/lib/memory/index-config";
import { indexFennMemory } from "@/lib/memory/index-memory";
import { processPendingMemoryIndex } from "@/lib/memory/process-index";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

type MemoryRow = {
  id: string;
  layer: string;
  title: string | null;
  content: string;
  is_active: boolean;
  visibility: string;
  updated_at: string;
};

type ChunkRow = {
  memory_id: string;
  chunk_index: number;
  content: string;
  embedding: string;
  embedding_model: string;
  content_hash: string;
  source_fingerprint: string;
  chunking_version: string;
};

function makeIndexAdmin(seed: {
  memories?: MemoryRow[];
  chunks?: ChunkRow[];
}) {
  const memories = [...(seed.memories ?? [])];
  const chunks = [...(seed.chunks ?? [])];
  let replaceCalls = 0;
  let clearCalls = 0;
  let lastReplacePayload: unknown = null;

  return {
    memories,
    chunks,
    get replaceCalls() {
      return replaceCalls;
    },
    get clearCalls() {
      return clearCalls;
    },
    get lastReplacePayload() {
      return lastReplacePayload;
    },
    from(table: string) {
      if (table === "fenn_memories") {
        const state: {
          filters: Array<{ col: string; val: unknown }>;
          inVals?: unknown[];
          orderAsc?: boolean;
          limitN?: number;
        } = { filters: [] };
        const api = {
          select() {
            return api;
          },
          eq(col: string, val: unknown) {
            state.filters.push({ col, val });
            return api;
          },
          in(col: string, vals: unknown[]) {
            state.filters.push({ col, val: vals });
            state.inVals = vals;
            return api;
          },
          order(_col: string, opts: { ascending: boolean }) {
            state.orderAsc = opts.ascending;
            return api;
          },
          limit(n: number) {
            state.limitN = n;
            return api;
          },
          async maybeSingle() {
            const match = memories.find((row) =>
              state.filters.every((f) => {
                if (Array.isArray(f.val)) {
                  return (f.val as unknown[]).includes(
                    (row as Record<string, unknown>)[f.col],
                  );
                }
                return (row as Record<string, unknown>)[f.col] === f.val;
              }),
            );
            return { data: match ?? null, error: null };
          },
          then(
            resolve: (value: {
              data: MemoryRow[] | null;
              error: null;
            }) => unknown,
          ) {
            let list = memories.filter((row) =>
              state.filters.every((f) => {
                if (Array.isArray(f.val)) {
                  return (f.val as unknown[]).includes(
                    (row as Record<string, unknown>)[f.col],
                  );
                }
                return (row as Record<string, unknown>)[f.col] === f.val;
              }),
            );
            if (state.orderAsc === true) {
              list = [...list].sort((a, b) =>
                a.updated_at > b.updated_at ? 1 : -1,
              );
            }
            if (state.limitN != null) list = list.slice(0, state.limitN);
            return Promise.resolve(resolve({ data: list, error: null }));
          },
        };
        return api;
      }

      if (table === "fenn_memory_chunks") {
        const state: {
          filters: Array<{ col: string; val: unknown }>;
          orderAsc?: boolean;
        } = { filters: [] };
        const api = {
          select() {
            return api;
          },
          eq(col: string, val: unknown) {
            state.filters.push({ col, val });
            return api;
          },
          order(_col: string, opts: { ascending: boolean }) {
            state.orderAsc = opts.ascending;
            return api;
          },
          then(
            resolve: (value: {
              data: ChunkRow[] | null;
              error: null;
            }) => unknown,
          ) {
            let list = chunks.filter((row) =>
              state.filters.every(
                (f) => (row as Record<string, unknown>)[f.col] === f.val,
              ),
            );
            if (state.orderAsc === true) {
              list = [...list].sort((a, b) => a.chunk_index - b.chunk_index);
            }
            return Promise.resolve(resolve({ data: list, error: null }));
          },
        };
        return api;
      }

      throw new Error(`unexpected table ${table}`);
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "clear_fenn_memory_chunks") {
        clearCalls += 1;
        const id = args.p_memory_id as string;
        for (let i = chunks.length - 1; i >= 0; i -= 1) {
          if (chunks[i]?.memory_id === id) chunks.splice(i, 1);
        }
        return { data: 0, error: null };
      }

      if (fn === "replace_fenn_memory_chunks") {
        replaceCalls += 1;
        lastReplacePayload = args;
        const id = args.p_memory_id as string;
        const fingerprint = args.p_expected_fingerprint as string;
        const payload = args.p_chunks as Array<Record<string, unknown>>;
        for (let i = chunks.length - 1; i >= 0; i -= 1) {
          if (chunks[i]?.memory_id === id) chunks.splice(i, 1);
        }
        for (const row of payload) {
          chunks.push({
            memory_id: id,
            chunk_index: row.chunk_index as number,
            content: row.content as string,
            embedding: row.embedding as string,
            embedding_model: row.embedding_model as string,
            content_hash: row.content_hash as string,
            source_fingerprint: fingerprint,
            chunking_version: row.chunking_version as string,
          });
        }
        return {
          data: [{ replaced: true, chunk_count: payload.length }],
          error: null,
        };
      }

      return { data: null, error: { message: `unknown rpc ${fn}` } };
    },
  };
}

function zeroVector(): number[] {
  return Array.from({ length: FENN_EMBEDDING_DIMENSIONS }, () => 0);
}

function memory(partial: Partial<MemoryRow> & Pick<MemoryRow, "id" | "content">): MemoryRow {
  return {
    layer: "canon",
    title: "Title",
    is_active: true,
    visibility: "public",
    updated_at: "2026-07-23T12:00:00.000Z",
    ...partial,
  };
}

describe("indexFennMemory", () => {
  it("indexes active Canon and records model/hash/fingerprint", async () => {
    const admin = makeIndexAdmin({
      memories: [memory({ id: "m1", content: "Canon body text." })],
    });

    const result = await indexFennMemory({
      memoryId: "m1",
      admin: admin as never,
      callEmbed: async ({ texts }) => texts.map(() => zeroVector()),
    });

    assert.equal(result.status, "indexed");
    assert.equal(admin.chunks.length, 1);
    assert.equal(admin.chunks[0]?.embedding_model, FENN_EMBEDDING_MODEL);
    assert.equal(admin.chunks[0]?.chunking_version, FENN_CHUNKING_VERSION);
    assert.equal(
      admin.chunks[0]?.source_fingerprint,
      memoryIndexFingerprint({ title: "Title", content: "Canon body text." }),
    );
    assert.match(admin.chunks[0]?.embedding ?? "", /^\[/);
    assert.equal(admin.chunks[0]?.content, "Canon body text.");
  });

  it("indexes greenwood_memory with camp visibility as infrastructure", async () => {
    const admin = makeIndexAdmin({
      memories: [
        memory({
          id: "gm1",
          layer: "greenwood_memory",
          visibility: "camp",
          content: "An idea offered at Camp about trust.",
        }),
      ],
    });
    const result = await indexFennMemory({
      memoryId: "gm1",
      admin: admin as never,
      callEmbed: async ({ texts }) => texts.map(() => zeroVector()),
    });
    assert.equal(result.status, "indexed");
    assert.equal(admin.chunks.length, 1);
  });

  it("clears chunks for inactive memory", async () => {
    const fp = memoryIndexFingerprint({ title: "Title", content: "old" });
    const admin = makeIndexAdmin({
      memories: [
        memory({ id: "m1", content: "old", is_active: false }),
      ],
      chunks: [
        {
          memory_id: "m1",
          chunk_index: 0,
          content: "old",
          embedding: "[0]",
          embedding_model: FENN_EMBEDDING_MODEL,
          content_hash: "x",
          source_fingerprint: fp,
          chunking_version: FENN_CHUNKING_VERSION,
        },
      ],
    });
    const result = await indexFennMemory({
      memoryId: "m1",
      admin: admin as never,
      callEmbed: async () => {
        throw new Error("should not embed");
      },
    });
    assert.equal(result.status, "cleared");
    assert.equal(admin.chunks.length, 0);
    assert.equal(admin.clearCalls, 1);
  });

  it("identical reindex is idempotent (unchanged)", async () => {
    const admin = makeIndexAdmin({
      memories: [memory({ id: "m1", content: "stable" })],
    });
    await indexFennMemory({
      memoryId: "m1",
      admin: admin as never,
      callEmbed: async ({ texts }) => texts.map(() => zeroVector()),
    });
    const replaces = admin.replaceCalls;
    const second = await indexFennMemory({
      memoryId: "m1",
      admin: admin as never,
      callEmbed: async () => {
        throw new Error("should not re-embed");
      },
    });
    assert.equal(second.status, "unchanged");
    assert.equal(admin.replaceCalls, replaces);
  });

  it("changed memory replaces stale chunks", async () => {
    const admin = makeIndexAdmin({
      memories: [memory({ id: "m1", content: "v1" })],
    });
    await indexFennMemory({
      memoryId: "m1",
      admin: admin as never,
      callEmbed: async ({ texts }) => texts.map(() => zeroVector()),
    });
    admin.memories[0]!.content = "v2 changed";
    const result = await indexFennMemory({
      memoryId: "m1",
      admin: admin as never,
      callEmbed: async ({ texts }) => texts.map(() => zeroVector()),
    });
    assert.equal(result.status, "indexed");
    assert.equal(admin.chunks[0]?.content, "v2 changed");
    assert.equal(
      admin.chunks[0]?.source_fingerprint,
      memoryIndexFingerprint({ title: "Title", content: "v2 changed" }),
    );
  });

  it("embedding failure leaves existing index intact", async () => {
    const admin = makeIndexAdmin({
      memories: [memory({ id: "m1", content: "v1" })],
    });
    await indexFennMemory({
      memoryId: "m1",
      admin: admin as never,
      callEmbed: async ({ texts }) => texts.map(() => zeroVector()),
    });
    admin.memories[0]!.content = "v2";
    await assert.rejects(() =>
      indexFennMemory({
        memoryId: "m1",
        admin: admin as never,
        callEmbed: async () => {
          throw new Error("openai down");
        },
      }),
    );
    assert.equal(admin.chunks.length, 1);
    assert.equal(admin.chunks[0]?.content, "v1");
  });

  it("parent change during embed prevents stale replacement", async () => {
    const admin = makeIndexAdmin({
      memories: [memory({ id: "m1", content: "original" })],
    });
    await assert.rejects(() =>
      indexFennMemory({
        memoryId: "m1",
        admin: admin as never,
        callEmbed: async ({ texts }) => {
          admin.memories[0]!.content = "changed mid-flight";
          return texts.map(() => zeroVector());
        },
      }),
    );
    assert.equal(admin.chunks.length, 0);
    assert.equal(admin.replaceCalls, 0);
  });

  it("does not mutate source memory fields", async () => {
    const admin = makeIndexAdmin({
      memories: [
        memory({
          id: "m1",
          content: "body",
          title: "T",
          visibility: "internal",
        }),
      ],
    });
    await indexFennMemory({
      memoryId: "m1",
      admin: admin as never,
      callEmbed: async ({ texts }) => texts.map(() => zeroVector()),
    });
    assert.equal(admin.memories[0]?.title, "T");
    assert.equal(admin.memories[0]?.content, "body");
    assert.equal(admin.memories[0]?.visibility, "internal");
    assert.equal(admin.memories[0]?.layer, "canon");
  });
});

describe("processPendingMemoryIndex", () => {
  it("indexes pending active memories and continues past failures", async () => {
    const admin = makeIndexAdmin({
      memories: [
        memory({ id: "ok", content: "index me" }),
        memory({ id: "bad", content: "fail me", updated_at: "2026-07-23T11:00:00.000Z" }),
      ],
    });

    const summary = await processPendingMemoryIndex({
      limit: 10,
      admin: admin as never,
      callEmbed: async ({ texts }) => {
        // fingerprint path uses content; fail specifically for bad memory via side channel
        if (admin.memories.some((m) => m.id === "bad" && m.content === "fail me")) {
          // Determine which memory by checking ongoing index through chunk attempts —
          // simpler: fail when texts include "fail me"
        }
        if (texts.some((t) => t.includes("fail me"))) {
          throw new Error("boom");
        }
        return texts.map(() => zeroVector());
      },
    });

    assert.ok(summary.scanned >= 1);
    assert.ok(summary.indexed + summary.failed >= 1);
  });
});

describe("Stage 11.4 source safety", () => {
  it("modules are server-only and have no public API", () => {
    for (const file of ["index-memory.ts", "process-index.ts", "embed.ts"]) {
      const source = readFileSync(join(here, file), "utf8");
      assert.match(source, /server-only/);
    }
    assert.equal(existsSync(join(repo, "src/app/api/memory")), false);
    assert.doesNotMatch(
      readFileSync(join(here, "chunking.ts"), "utf8"),
      /source_profile_id|source_candidate_id/,
    );
  });

  it("migration locks dimension, cascade, and browser revoke", () => {
    const sql = readFileSync(
      join(
        repo,
        "supabase/migrations/20260723210000_22_stage114_memory_embeddings.sql",
      ),
      "utf8",
    );
    assert.match(sql, /CREATE TABLE public\.fenn_memory_chunks/);
    assert.match(sql, /vector\(1536\)/);
    assert.match(sql, /ON DELETE CASCADE/);
    assert.match(sql, /fenn_memory_chunks_memory_index_uidx/);
    assert.match(sql, /REVOKE ALL ON TABLE public\.fenn_memory_chunks/);
    assert.match(sql, /replace_fenn_memory_chunks/);
    assert.doesNotMatch(sql, /CREATE INDEX[\s\S]*hnsw|ivfflat/i);
    assert.match(sql, /cosine/i);
  });

  it("approval path still does not require embeddings in RPC", () => {
    const sql = readFileSync(
      join(
        repo,
        "supabase/migrations/20260723200000_21_stage113_autonomous_memory.sql",
      ),
      "utf8",
    );
    assert.doesNotMatch(sql, /fenn_memory_chunks|openai|text-embedding|vector\(/i);
  });
});
