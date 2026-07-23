import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { WallError } from "./errors";
import { getPublicWallEntry, listPublicWallEntries, toPublicWallEntry } from "./read";
import {
  PUBLIC_WALL_ENTRIES_DEFAULT_LIMIT,
  PUBLIC_WALL_ENTRIES_MAX_LIMIT,
  WALL_BODY_MAX_CHARS,
} from "./types";
import {
  validateWriteFennWallEntryInput,
  writeFennWallEntry,
} from "./write";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

type StoredRow = {
  id: string;
  body: string;
  created_at: string;
  source_type: string;
  source_external_id: string | null;
};

function makeMemoryAdmin(seed: StoredRow[] = []) {
  const rows = [...seed];
  let seq = 0;

  return {
    rows,
    from() {
      const state: {
        filters: Array<{ col: string; val: unknown }>;
        orderAsc?: boolean;
        limitN?: number;
        insertPayload?: Record<string, unknown>;
      } = { filters: [] };

      const api = {
        select() {
          return api;
        },
        insert(payload: Record<string, unknown>) {
          state.insertPayload = payload;
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
        limit(n: number) {
          state.limitN = n;
          return api;
        },
        async maybeSingle() {
          const match = rows.find((row) =>
            state.filters.every((f) => {
              if (f.col === "id") return row.id === f.val;
              if (f.col === "source_type") return row.source_type === f.val;
              if (f.col === "source_external_id") {
                return row.source_external_id === f.val;
              }
              return false;
            }),
          );
          return { data: match ?? null, error: null };
        },
        async single() {
          if (state.insertPayload) {
            const sourceType = state.insertPayload.source_type as string;
            const sourceExternalId =
              (state.insertPayload.source_external_id as string | null) ?? null;
            if (sourceExternalId != null) {
              const clash = rows.find(
                (r) =>
                  r.source_type === sourceType &&
                  r.source_external_id === sourceExternalId,
              );
              if (clash) {
                return {
                  data: null,
                  error: { code: "23505", message: "duplicate key" },
                };
              }
            }
            seq += 1;
            const row: StoredRow = {
              id: `w${seq}`,
              body: state.insertPayload.body as string,
              created_at: new Date(
                Date.UTC(2026, 6, 23, 12, 0, seq),
              ).toISOString(),
              source_type: sourceType,
              source_external_id: sourceExternalId,
            };
            rows.push(row);
            return { data: row, error: null };
          }

          const match = rows.find((row) =>
            state.filters.every((f) => row.id === f.val),
          );
          if (!match) {
            return { data: null, error: { message: "not found" } };
          }
          return { data: match, error: null };
        },
        then(
          resolve: (value: {
            data: StoredRow[] | null;
            error: null;
          }) => unknown,
        ) {
          let list = [...rows];
          if (state.orderAsc === false) {
            list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
          } else if (state.orderAsc === true) {
            list.sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
          }
          if (state.limitN != null) {
            list = list.slice(0, state.limitN);
          }
          return Promise.resolve(
            resolve({
              data: list.map((r) => ({
                id: r.id,
                body: r.body,
                created_at: r.created_at,
              })) as StoredRow[],
              error: null,
            }),
          );
        },
      };

      return api;
    },
  };
}

describe("Wall public DTO", () => {
  it("strips source provenance fields", () => {
    const pub = toPublicWallEntry({
      id: "e1",
      body: "hello",
      created_at: "2026-07-23T12:00:00.000Z",
      source_type: "x_agent",
      source_external_id: "tweet:1",
    });
    assert.deepEqual(pub, {
      id: "e1",
      body: "hello",
      createdAt: "2026-07-23T12:00:00.000Z",
      markCount: 0,
    });
    assert.equal("sourceType" in pub, false);
    assert.equal("sourceExternalId" in pub, false);
    assert.equal("profileId" in pub, false);
  });

  it("includes aggregate markCount from nested count", () => {
    const pub = toPublicWallEntry({
      id: "e1",
      body: "hello",
      created_at: "2026-07-23T12:00:00.000Z",
      wall_marks: [{ count: 17 }],
    });
    assert.equal(pub.markCount, 17);
  });
});

describe("listPublicWallEntries", () => {
  it("returns newest first with default limit 30", async () => {
    const admin = makeMemoryAdmin(
      Array.from({ length: 35 }, (_, i) => ({
        id: `id-${i}`,
        body: `b${i}`,
        created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        source_type: "system",
        source_external_id: null,
      })),
    );
    const entries = await listPublicWallEntries({
      admin: admin as never,
    });
    assert.equal(entries.length, PUBLIC_WALL_ENTRIES_DEFAULT_LIMIT);
    assert.equal(entries[0]?.body, "b34");
    assert.equal(entries[29]?.body, "b5");
  });

  it("bounds requested limit", async () => {
    const admin = makeMemoryAdmin(
      Array.from({ length: 5 }, (_, i) => ({
        id: `id-${i}`,
        body: `b${i}`,
        created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        source_type: "system",
        source_external_id: null,
      })),
    );
    const entries = await listPublicWallEntries({
      limit: 999,
      admin: admin as never,
    });
    assert.ok(entries.length <= PUBLIC_WALL_ENTRIES_MAX_LIMIT);
    assert.equal(entries.length, 5);
  });
});

describe("validateWriteFennWallEntryInput", () => {
  it("preserves ASCII spacing and newlines; rejects empty/whitespace-only", () => {
    const ascii = "      /\\\n     /  \\\n    /____\\\n";
    const ok = validateWriteFennWallEntryInput({
      body: ascii,
      sourceType: "system",
    });
    assert.equal(ok.body, ascii);

    assert.throws(
      () =>
        validateWriteFennWallEntryInput({
          body: "",
          sourceType: "system",
        }),
      (err: unknown) =>
        err instanceof WallError && err.code === "wall_invalid_body",
    );
    assert.throws(
      () =>
        validateWriteFennWallEntryInput({
          body: "   \n\t  ",
          sourceType: "system",
        }),
      (err: unknown) =>
        err instanceof WallError && err.code === "wall_invalid_body",
    );
  });

  it("allows 4000 chars and rejects 4001", () => {
    const exact = "a".repeat(WALL_BODY_MAX_CHARS);
    assert.equal(
      validateWriteFennWallEntryInput({
        body: exact,
        sourceType: "bootstrap",
      }).body.length,
      4000,
    );
    assert.throws(
      () =>
        validateWriteFennWallEntryInput({
          body: "a".repeat(WALL_BODY_MAX_CHARS + 1),
          sourceType: "bootstrap",
        }),
      (err: unknown) =>
        err instanceof WallError && err.code === "wall_invalid_body",
    );
  });

  it("rejects invalid source type", () => {
    assert.throws(
      () =>
        validateWriteFennWallEntryInput({
          body: "ok",
          sourceType: "human" as never,
        }),
      (err: unknown) =>
        err instanceof WallError && err.code === "wall_invalid_source",
    );
  });
});

describe("writeFennWallEntry", () => {
  it("creates a valid system entry", async () => {
    const admin = makeMemoryAdmin();
    const result = await writeFennWallEntry(
      { body: "someone asked.", sourceType: "system" },
      admin as never,
    );
    assert.equal(result.created, true);
    assert.equal(result.entry.body, "someone asked.");
    assert.equal(admin.rows.length, 1);
    assert.equal(admin.rows[0]?.source_type, "system");
  });

  it("preserves ASCII body exactly", async () => {
    const admin = makeMemoryAdmin();
    const body = "      /\\\n     /  \\\n    /____\\\n";
    const result = await writeFennWallEntry(
      { body, sourceType: "bootstrap" },
      admin as never,
    );
    assert.equal(result.entry.body, body);
  });

  it("is idempotent for identical x_agent provenance", async () => {
    const admin = makeMemoryAdmin();
    const input = {
      body: "look at the wall.",
      sourceType: "x_agent" as const,
      sourceExternalId: "x:111",
    };
    const first = await writeFennWallEntry(input, admin as never);
    const second = await writeFennWallEntry(input, admin as never);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.entry.id, first.entry.id);
    assert.equal(admin.rows.length, 1);
  });

  it("rejects same provenance with different body without mutating", async () => {
    const admin = makeMemoryAdmin();
    await writeFennWallEntry(
      {
        body: "original",
        sourceType: "x_agent",
        sourceExternalId: "x:222",
      },
      admin as never,
    );
    await assert.rejects(
      () =>
        writeFennWallEntry(
          {
            body: "changed",
            sourceType: "x_agent",
            sourceExternalId: "x:222",
          },
          admin as never,
        ),
      (err: unknown) =>
        err instanceof WallError && err.code === "wall_idempotency_conflict",
    );
    assert.equal(admin.rows.length, 1);
    assert.equal(admin.rows[0]?.body, "original");
  });

  it("creates distinct entries for different external ids", async () => {
    const admin = makeMemoryAdmin();
    const a = await writeFennWallEntry(
      { body: "one", sourceType: "x_agent", sourceExternalId: "x:a" },
      admin as never,
    );
    const b = await writeFennWallEntry(
      { body: "two", sourceType: "x_agent", sourceExternalId: "x:b" },
      admin as never,
    );
    assert.notEqual(a.entry.id, b.entry.id);
    assert.equal(admin.rows.length, 2);
  });

  it("typed contract cannot accept caller id or createdAt", () => {
    const source = readFileSync(join(here, "write.ts"), "utf8");
    const start = source.indexOf(".insert({");
    const end = source.indexOf("})", start);
    assert.ok(start >= 0 && end > start);
    const insertBlock = source.slice(start, end + 2);
    assert.match(insertBlock, /body:\s*validated\.body/);
    assert.match(insertBlock, /source_type:\s*validated\.sourceType/);
    assert.match(insertBlock, /source_external_id:\s*validated\.sourceExternalId/);
    assert.doesNotMatch(insertBlock, /^\s*id:/m);
    assert.doesNotMatch(insertBlock, /created_at|createdAt|profileId|author/);
  });
});

describe("getPublicWallEntry", () => {
  it("returns a single public entry", async () => {
    const admin = makeMemoryAdmin([
      {
        id: "abc",
        body: "carved",
        created_at: "2026-07-23T10:00:00.000Z",
        source_type: "system",
        source_external_id: null,
      },
    ]);
    const entry = await getPublicWallEntry("abc", admin as never);
    assert.deepEqual(entry, {
      id: "abc",
      body: "carved",
      createdAt: "2026-07-23T10:00:00.000Z",
      markCount: 0,
    });
  });
});

describe("Stage 10.5.1 Wall source safety", () => {
  it("modules are server-only and narrow", () => {
    for (const file of ["read.ts", "write.ts"]) {
      const source = readFileSync(join(here, file), "utf8");
      assert.match(source, /server-only/);
      assert.doesNotMatch(source, /openai|@privy-io|x\.com|twitter/i);
      assert.doesNotMatch(
        source,
        /fenn_memories|memory_candidates|camp_messages/,
      );
      assert.doesNotMatch(source, /\bembedding\b|openai/);
    }
    const write = readFileSync(join(here, "write.ts"), "utf8");
    assert.match(write, /createAdminClient/);
  });

  it("no public Wall write POST route", () => {
    assert.equal(existsSync(join(repo, "src/app/api/wall/route.ts")), false);
  });

  it("migration enforces append-only + public select + provenance unique", () => {
    const sql = readFileSync(
      join(
        repo,
        "supabase/migrations/20260723160000_17_stage105_wall_entries.sql",
      ),
      "utf8",
    );
    assert.match(sql, /CREATE TABLE public\.wall_entries/);
    assert.match(sql, /char_length\(body\) <= 4000/);
    assert.match(sql, /bootstrap.*system.*x_agent|IN \('bootstrap'/);
    assert.match(sql, /wall_entries_source_provenance_uidx/);
    assert.match(sql, /prevent_wall_entries_mutation/);
    assert.match(sql, /wall_entries_public_select/);
    assert.match(sql, /REVOKE INSERT, UPDATE, DELETE/);
    assert.doesNotMatch(sql, /wall_marks/);
  });
});
