import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { WallError } from "./errors";
import {
  getMarkedEntryIdsForProfile,
  leaveWallMark,
} from "./marks";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

const ENTRY_A = "11111111-1111-4111-8111-111111111111";
const ENTRY_B = "22222222-2222-4222-8222-222222222222";
const PROFILE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MISSING = "99999999-9999-4999-8999-999999999999";

type EntryRow = { id: string };
type MarkRow = {
  id: string;
  entry_id: string;
  profile_id: string;
  created_at: string;
};

function makeMarkAdmin(seedEntries: EntryRow[], seedMarks: MarkRow[] = []) {
  const entries = [...seedEntries];
  const marks = [...seedMarks];
  let seq = 0;

  return {
    entries,
    marks,
    from(table: string) {
      if (table === "wall_entries") {
        const state: { filters: Array<{ col: string; val: unknown }> } = {
          filters: [],
        };
        const api: {
          select: () => typeof api;
          eq: (col: string, val: unknown) => typeof api;
          maybeSingle: () => Promise<{ data: EntryRow | null; error: null }>;
        } = {
          select() {
            return api;
          },
          eq(col: string, val: unknown) {
            state.filters.push({ col, val });
            return api;
          },
          async maybeSingle() {
            const match = entries.find((row) =>
              state.filters.every((f) => row.id === f.val),
            );
            return { data: match ?? null, error: null };
          },
        };
        return api;
      }

      if (table === "wall_marks") {
        const state: {
          filters: Array<{ col: string; val: unknown }>;
          insertPayload: Record<string, unknown> | null;
          countExact: boolean;
          head: boolean;
        } = {
          filters: [],
          insertPayload: null,
          countExact: false,
          head: false,
        };

        const execute = async () => {
          if (state.insertPayload) {
            const entryId = state.insertPayload.entry_id as string;
            const profileId = state.insertPayload.profile_id as string;
            const clash = marks.find(
              (m) => m.entry_id === entryId && m.profile_id === profileId,
            );
            if (clash) {
              return {
                data: null,
                error: { code: "23505", message: "duplicate key" },
              };
            }
            seq += 1;
            marks.push({
              id: `m${seq}`,
              entry_id: entryId,
              profile_id: profileId,
              created_at: new Date().toISOString(),
            });
            return { data: null, error: null };
          }

          const list = marks.filter((row) =>
            state.filters.every((f) => {
              const value = (row as Record<string, unknown>)[f.col];
              if (Array.isArray(f.val)) {
                return (f.val as unknown[]).includes(value);
              }
              return value === f.val;
            }),
          );

          if (state.countExact && state.head) {
            return { data: null, error: null, count: list.length };
          }

          return {
            data: list.map((r) => ({ entry_id: r.entry_id })),
            error: null,
            count: list.length,
          };
        };

        const api = {
          select(_cols?: string, opts?: { count?: string; head?: boolean }) {
            if (opts?.count === "exact") state.countExact = true;
            if (opts?.head) state.head = true;
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
          in(col: string, vals: unknown[]) {
            state.filters.push({ col, val: vals });
            return api;
          },
          then(
            resolve: (value: unknown) => unknown,
            reject?: (reason: unknown) => unknown,
          ) {
            return execute().then(resolve, reject);
          },
        };

        return api;
      }

      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("leaveWallMark", () => {
  it("creates first mark and returns count", async () => {
    const admin = makeMarkAdmin([{ id: ENTRY_A }]);
    const result = await leaveWallMark(ENTRY_A, PROFILE_A, admin as never);
    assert.deepEqual(result, { status: "marked", count: 1 });
    assert.equal(admin.marks.length, 1);
    assert.equal(admin.marks[0]?.profile_id, PROFILE_A);
  });

  it("duplicate returns already_marked without second row", async () => {
    const admin = makeMarkAdmin([{ id: ENTRY_A }]);
    await leaveWallMark(ENTRY_A, PROFILE_A, admin as never);
    const second = await leaveWallMark(ENTRY_A, PROFILE_A, admin as never);
    assert.deepEqual(second, { status: "already_marked", count: 1 });
    assert.equal(admin.marks.length, 1);
  });

  it("concurrent-style unique violation yields already_marked", async () => {
    const admin = makeMarkAdmin(
      [{ id: ENTRY_A }],
      [
        {
          id: "m0",
          entry_id: ENTRY_A,
          profile_id: PROFILE_A,
          created_at: "2026-07-23T12:00:00.000Z",
        },
      ],
    );
    const result = await leaveWallMark(ENTRY_A, PROFILE_A, admin as never);
    assert.equal(result.status, "already_marked");
    assert.equal(result.count, 1);
    assert.equal(admin.marks.length, 1);
  });

  it("different profiles can mark the same entry", async () => {
    const admin = makeMarkAdmin([{ id: ENTRY_A }]);
    await leaveWallMark(ENTRY_A, PROFILE_A, admin as never);
    const second = await leaveWallMark(ENTRY_A, PROFILE_B, admin as never);
    assert.equal(second.status, "marked");
    assert.equal(second.count, 2);
    assert.equal(admin.marks.length, 2);
  });

  it("same profile may mark different entries", async () => {
    const admin = makeMarkAdmin([{ id: ENTRY_A }, { id: ENTRY_B }]);
    await leaveWallMark(ENTRY_A, PROFILE_A, admin as never);
    const second = await leaveWallMark(ENTRY_B, PROFILE_A, admin as never);
    assert.equal(second.status, "marked");
    assert.equal(admin.marks.length, 2);
  });

  it("missing wall entry fails controlled", async () => {
    const admin = makeMarkAdmin([{ id: ENTRY_A }]);
    await assert.rejects(
      () => leaveWallMark(MISSING, PROFILE_A, admin as never),
      (err: unknown) =>
        err instanceof WallError && err.code === "wall_entry_not_found",
    );
    assert.equal(admin.marks.length, 0);
  });

  it("rejects non-uuid entry id", async () => {
    const admin = makeMarkAdmin([{ id: ENTRY_A }]);
    await assert.rejects(
      () => leaveWallMark("not-a-uuid", PROFILE_A, admin as never),
      (err: unknown) =>
        err instanceof WallError && err.code === "wall_invalid_entry_id",
    );
  });
});

describe("getMarkedEntryIdsForProfile", () => {
  it("returns only the current profile's marked entry ids", async () => {
    const admin = makeMarkAdmin(
      [{ id: ENTRY_A }, { id: ENTRY_B }],
      [
        {
          id: "m1",
          entry_id: ENTRY_A,
          profile_id: PROFILE_A,
          created_at: "2026-07-23T12:00:00.000Z",
        },
        {
          id: "m2",
          entry_id: ENTRY_B,
          profile_id: PROFILE_B,
          created_at: "2026-07-23T12:00:00.000Z",
        },
      ],
    );
    const marked = await getMarkedEntryIdsForProfile(
      PROFILE_A,
      [ENTRY_A, ENTRY_B],
      admin as never,
    );
    assert.equal(marked.has(ENTRY_A), true);
    assert.equal(marked.has(ENTRY_B), false);
  });
});

describe("Stage 10.5.3 mark source safety", () => {
  it("marks module is server-only and has no LEAF/Greenwood/X", () => {
    const source = readFileSync(join(here, "marks.ts"), "utf8");
    assert.match(source, /server-only/);
    assert.doesNotMatch(source, /leaf|greenwood|openai|twitter|x\.com/i);
    assert.doesNotMatch(source, /toggleMark|DELETE|removeWallMark/);
  });

  it("migration creates unique marks without browser mutation", () => {
    const sql = readFileSync(
      join(
        repo,
        "supabase/migrations/20260723170000_18_stage105_wall_marks.sql",
      ),
      "utf8",
    );
    assert.match(sql, /CREATE TABLE public\.wall_marks/);
    assert.match(sql, /wall_marks_entry_profile_uidx/);
    assert.match(sql, /prevent_wall_marks_mutation/);
    assert.match(sql, /REVOKE ALL ON public\.wall_marks FROM anon, authenticated/);
    assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*INSERT|FOR INSERT/);
  });

  it("mark API routes use Privy → profile and ignore client profileId", () => {
    const mark = readFileSync(
      join(repo, "src/app/api/wall/[entryId]/mark/route.ts"),
      "utf8",
    );
    assert.match(mark, /getVerifiedPrivyUser/);
    assert.match(mark, /findProfileByPrivyUserId/);
    assert.match(mark, /leaveWallMark\(entryId, profile\.id/);
    assert.match(mark, /outlaw_registration_required/);
    assert.match(mark, /unauthorized/);
    assert.match(mark, /Request body must be empty/);
    assert.doesNotMatch(mark, /body\.profileId|profileId\s*=/);

    const status = readFileSync(
      join(repo, "src/app/api/wall/marks/route.ts"),
      "utf8",
    );
    assert.match(status, /getVerifiedPrivyUser/);
    assert.match(status, /getMarkedEntryIdsForProfile/);
    assert.doesNotMatch(status, /profile_ids|outlaw_number|reactors/i);
  });

  it("no DELETE/toggle mark endpoint", () => {
    assert.equal(
      existsSync(join(repo, "src/app/api/wall/[entryId]/mark/route.ts")),
      true,
    );
    const mark = readFileSync(
      join(repo, "src/app/api/wall/[entryId]/mark/route.ts"),
      "utf8",
    );
    assert.doesNotMatch(mark, /export async function (DELETE|PUT|PATCH)/);
    assert.doesNotMatch(mark, /toggle/);
  });

  it("public DTO exposes markCount only — no reactor identities", () => {
    const types = readFileSync(join(here, "types.ts"), "utf8");
    assert.match(types, /markCount:\s*number/);
    assert.doesNotMatch(types, /markedBy|profileIds/);
    assert.doesNotMatch(types, /\breactors?\b/);

    const read = readFileSync(join(here, "read.ts"), "utf8");
    assert.match(read, /wall_marks\(count\)|loadMarkCounts/);
    assert.doesNotMatch(read, /profile_id/);
  });
});
