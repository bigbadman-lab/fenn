import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { FENN_EMBEDDING_DIMENSIONS, FENN_EMBEDDING_MODEL } from "@/lib/memory/index-config";
import { retrieveFennKnowledge } from "@/lib/memory/retrieve";
import { MemoryRetrieveError } from "@/lib/memory/retrieve-errors";
import { FENN_SCOPE_VISIBILITY } from "@/lib/memory/retrieve-scope";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function zeroVector(): number[] {
  return Array.from({ length: FENN_EMBEDDING_DIMENSIONS }, () => 0);
}

type FakeChunk = {
  memory_id: string;
  chunk_index: number;
  content: string;
  title: string | null;
  layer: string;
  visibility: string;
  is_active: boolean;
  cosine_distance: number;
  // Provenance that must never appear in DTO
  source_candidate_id?: string;
  source_message_id?: string;
  source_profile_id?: string;
  approved_by_actor_id?: string;
  embedding?: string;
};

function makeRetrieveAdmin(chunks: FakeChunk[]) {
  const rpcCalls: Array<Record<string, unknown>> = [];
  return {
    rpcCalls,
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, ...args });
      if (name !== "search_fenn_memory_chunks") {
        return Promise.resolve({ data: null, error: { message: "unknown rpc" } });
      }
      const scope = String(args.p_scope ?? "");
      const allowed = FENN_SCOPE_VISIBILITY[scope as keyof typeof FENN_SCOPE_VISIBILITY];
      if (!allowed) {
        return Promise.resolve({
          data: null,
          error: { message: "invalid scope" },
        });
      }
      const filtered = chunks
        .filter(
          (c) =>
            c.is_active &&
            ["canon", "greenwood_memory"].includes(c.layer) &&
            (allowed as readonly string[]).includes(c.visibility),
        )
        .sort((a, b) => a.cosine_distance - b.cosine_distance)
        .slice(0, Number(args.p_limit ?? 20))
        .map((c) => ({
          memory_id: c.memory_id,
          chunk_index: c.chunk_index,
          content: c.content,
          title: c.title,
          layer: c.layer,
          visibility: c.visibility,
          cosine_distance: c.cosine_distance,
        }));
      return Promise.resolve({ data: filtered, error: null });
    },
  };
}

const fixtures: FakeChunk[] = [
  {
    memory_id: "canon-leaf",
    chunk_index: 0,
    content: "LEAF is the standing unit of FENN.",
    title: "LEAF",
    layer: "canon",
    visibility: "public",
    is_active: true,
    cosine_distance: 0.1,
  },
  {
    memory_id: "canon-wall",
    chunk_index: 0,
    content: "The Wall is a public mark surface.",
    title: "The Wall",
    layer: "canon",
    visibility: "public",
    is_active: true,
    cosine_distance: 0.4,
  },
  {
    memory_id: "camp-persist",
    chunk_index: 0,
    content: "Camp values persistence over novelty.",
    title: "Persistence",
    layer: "greenwood_memory",
    visibility: "camp",
    is_active: true,
    cosine_distance: 0.12,
    source_candidate_id: "cand-secret",
    source_message_id: "msg-secret",
    source_profile_id: "prof-secret",
    approved_by_actor_id: "actor-secret",
    embedding: "[0,1,2]",
  },
  {
    memory_id: "internal-note",
    chunk_index: 0,
    content: "Internal ops note about indexing.",
    title: "Ops",
    layer: "greenwood_memory",
    visibility: "internal",
    is_active: true,
    cosine_distance: 0.11,
  },
  {
    memory_id: "inactive-canon",
    chunk_index: 0,
    content: "Deprecated LEAF definition.",
    title: "Old LEAF",
    layer: "canon",
    visibility: "public",
    is_active: false,
    cosine_distance: 0.01,
  },
];

describe("retrieveFennKnowledge scopes", () => {
  it("public_agent returns public Canon and never camp/internal", async () => {
    const admin = makeRetrieveAdmin(fixtures);
    const results = await retrieveFennKnowledge({
      query: "What is LEAF?",
      scope: "public_agent",
      admin: admin as never,
      callEmbed: async ({ model, texts }) => {
        assert.equal(model, FENN_EMBEDDING_MODEL);
        assert.equal(texts.length, 1);
        return texts.map(() => zeroVector());
      },
    });
    assert.ok(results.some((r) => r.memoryId === "canon-leaf"));
    assert.equal(
      results.every((r) => r.visibility === "public"),
      true,
    );
    assert.equal(
      results.some((r) => r.memoryId === "camp-persist"),
      false,
    );
    assert.equal(
      results.some((r) => r.memoryId === "internal-note"),
      false,
    );
    assert.equal(
      results.some((r) => r.memoryId === "inactive-canon"),
      false,
    );
  });

  it("camp returns public + camp but never internal", async () => {
    const admin = makeRetrieveAdmin(fixtures);
    const results = await retrieveFennKnowledge({
      query: "persistence at Camp",
      scope: "camp",
      admin: admin as never,
      callEmbed: async ({ texts }) => texts.map(() => zeroVector()),
    });
    assert.ok(results.some((r) => r.memoryId === "camp-persist"));
    assert.equal(
      results.some((r) => r.visibility === "internal"),
      false,
    );
  });

  it("internal may return all active visibility classes", async () => {
    const admin = makeRetrieveAdmin(fixtures);
    const results = await retrieveFennKnowledge({
      query: "indexing ops",
      scope: "internal",
      limit: 10,
      admin: admin as never,
      callEmbed: async ({ texts }) => texts.map(() => zeroVector()),
    });
    const vis = new Set(results.map((r) => r.visibility));
    assert.ok(vis.has("internal") || results.some((r) => r.memoryId === "internal-note"));
  });

  it("rejects invalid scope and empty query", async () => {
    const admin = makeRetrieveAdmin(fixtures);
    await assert.rejects(
      () =>
        retrieveFennKnowledge({
          query: "ok",
          scope: "hack" as never,
          admin: admin as never,
          callEmbed: async ({ texts }) => texts.map(() => zeroVector()),
        }),
      (e: unknown) =>
        e instanceof MemoryRetrieveError &&
        e.code === "memory_retrieve_invalid_scope",
    );
    await assert.rejects(
      () =>
        retrieveFennKnowledge({
          query: "   ",
          scope: "camp",
          admin: admin as never,
          callEmbed: async ({ texts }) => texts.map(() => zeroVector()),
        }),
      (e: unknown) =>
        e instanceof MemoryRetrieveError &&
        e.code === "memory_retrieve_invalid_query",
    );
  });

  it("input type has no visibility array / filter escape hatches", () => {
    const source = readFileSync(join(here, "retrieve.ts"), "utf8");
    assert.match(source, /RetrieveFennKnowledgeInput/);
    assert.doesNotMatch(
      source,
      /visibilities\s*:|visibilityList|rawFilter|orderByOperator/,
    );
  });
});

describe("retrieveFennKnowledge privacy + embed", () => {
  it("DTO never exposes provenance or embeddings", async () => {
    const admin = makeRetrieveAdmin(fixtures);
    const results = await retrieveFennKnowledge({
      query: "persistence",
      scope: "camp",
      admin: admin as never,
      callEmbed: async ({ texts }) => texts.map(() => zeroVector()),
    });
    const camp = results.find((r) => r.memoryId === "camp-persist");
    assert.ok(camp);
    const json = JSON.stringify(camp);
    for (const banned of [
      "source_candidate_id",
      "source_message_id",
      "source_profile_id",
      "approved_by_actor_id",
      "embedding",
      "cand-secret",
      "msg-secret",
      "prof-secret",
      "actor-secret",
    ]) {
      assert.equal(json.includes(banned), false, banned);
    }
    assert.equal("text" in camp, true);
    assert.equal("score" in camp, true);
  });

  it("invalid embed dimension fails cleanly without inventing results", async () => {
    const admin = makeRetrieveAdmin(fixtures);
    await assert.rejects(
      () =>
        retrieveFennKnowledge({
          query: "LEAF",
          scope: "public_agent",
          admin: admin as never,
          callEmbed: async () => [[0, 1, 2]],
        }),
      (e: unknown) => e instanceof MemoryRetrieveError,
    );
    assert.equal(admin.rpcCalls.length, 0);
  });

  it("embed failure does not call search RPC", async () => {
    const admin = makeRetrieveAdmin(fixtures);
    await assert.rejects(
      () =>
        retrieveFennKnowledge({
          query: "LEAF",
          scope: "public_agent",
          admin: admin as never,
          callEmbed: async () => {
            throw new Error("openai down");
          },
        }),
      (e: unknown) =>
        e instanceof MemoryRetrieveError &&
        e.code === "memory_retrieve_embed_failed",
    );
    assert.equal(admin.rpcCalls.length, 0);
  });
});

describe("Stage 11.5 source safety", () => {
  it("retrieve module is server-only and has no public API route", () => {
    const source = readFileSync(join(here, "retrieve.ts"), "utf8");
    assert.match(source, /server-only/);
    assert.equal(existsSync(join(repo, "src/app/api/memory")), false);
    assert.equal(existsSync(join(repo, "src/app/api/retrieve")), false);
  });

  it("migration locks search RPC and FTS simple config", () => {
    const sql = readFileSync(
      join(
        repo,
        "supabase/migrations/20260723220000_23_stage115_knowledge_retrieval.sql",
      ),
      "utf8",
    );
    assert.match(sql, /search_fenn_memory_chunks/);
    assert.match(sql, /to_tsvector\('simple'/);
    assert.match(sql, /visibility = 'public'/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.search_fenn_memory_chunks/);
    assert.match(sql, /GRANT EXECUTE[\s\S]*TO service_role/);
    assert.doesNotMatch(sql, /source_profile_id|source_candidate_id|source_message_id|approved_by_actor_id/);
    assert.match(
      sql,
      /RETURNS TABLE \(\s*memory_id uuid,\s*chunk_index integer,\s*content text,\s*title text,\s*layer text,\s*visibility text,\s*cosine_distance double precision\s*\)/,
    );
    assert.doesNotMatch(sql, /hnsw|ivfflat/i);
  });

  it("ops scripts use .env.local not .env", () => {
    const pkg = readFileSync(join(repo, "package.json"), "utf8");
    assert.match(pkg, /"canon:sync": .+--env-file=\.env\.local/);
    assert.match(pkg, /"memory:process-pending": .+--env-file=\.env\.local/);
    assert.match(pkg, /"memory:index": .+--env-file=\.env\.local/);
    assert.match(pkg, /"memory:retrieve": .+--env-file=\.env\.local/);
    assert.doesNotMatch(pkg, /--env-file=\.env"/);
  });
});
