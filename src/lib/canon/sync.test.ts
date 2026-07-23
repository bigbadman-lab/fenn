import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANON_METADATA_KEY,
  CANON_SYNC_ACTOR_ID,
  listActiveCanonMemories,
  syncFennCanon,
} from "@/lib/canon/sync";

type MemoryRow = {
  id: string;
  layer: string;
  title: string | null;
  content: string;
  is_active: boolean;
  visibility: string;
  metadata: Record<string, unknown>;
  source_candidate_id: string | null;
  source_message_id: string | null;
  source_profile_id: string | null;
  approved_at: string | null;
  approved_by_actor_id: string | null;
};

function makeMemoryAdmin(seed: MemoryRow[] = []) {
  const rows = [...seed];
  let seq = 0;

  return {
    rows,
    from(table: string) {
      if (table !== "fenn_memories") {
        throw new Error(`unexpected table ${table}`);
      }

      const state: {
        filters: Array<{ col: string; val: unknown }>;
        insertPayload?: Record<string, unknown>;
        updatePayload?: Record<string, unknown>;
      } = { filters: [] };

      const matches = () =>
        rows.filter((row) =>
          state.filters.every((f) => {
            const value = (row as Record<string, unknown>)[f.col];
            return value === f.val;
          }),
        );

      const api = {
        select() {
          return api;
        },
        insert(payload: Record<string, unknown>) {
          state.insertPayload = payload;
          return api;
        },
        update(payload: Record<string, unknown>) {
          state.updatePayload = payload;
          return api;
        },
        eq(col: string, val: unknown) {
          state.filters.push({ col, val });
          return api;
        },
        then(
          resolve: (value: {
            data: MemoryRow[] | null;
            error: null;
          }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve()
            .then(() => {
              if (state.insertPayload) {
                seq += 1;
                const row: MemoryRow = {
                  id: `m${seq}`,
                  layer: state.insertPayload.layer as string,
                  title: (state.insertPayload.title as string) ?? null,
                  content: state.insertPayload.content as string,
                  is_active: Boolean(state.insertPayload.is_active ?? true),
                  visibility: state.insertPayload.visibility as string,
                  metadata: (state.insertPayload.metadata ?? {}) as Record<
                    string,
                    unknown
                  >,
                  source_candidate_id:
                    (state.insertPayload.source_candidate_id as string | null) ??
                    null,
                  source_message_id:
                    (state.insertPayload.source_message_id as string | null) ??
                    null,
                  source_profile_id:
                    (state.insertPayload.source_profile_id as string | null) ??
                    null,
                  approved_at:
                    (state.insertPayload.approved_at as string | null) ?? null,
                  approved_by_actor_id:
                    (state.insertPayload
                      .approved_by_actor_id as string | null) ?? null,
                };
                rows.push(row);
                return { data: [row], error: null };
              }

              if (state.updatePayload) {
                const targets = matches();
                for (const row of targets) {
                  Object.assign(row, state.updatePayload);
                }
                return { data: targets, error: null };
              }

              return { data: matches(), error: null };
            })
            .then(resolve, reject);
        },
      };

      return api;
    },
  };
}

describe("syncFennCanon", () => {
  it("inserts Canon on first sync", async () => {
    const admin = makeMemoryAdmin();
    const result = await syncFennCanon(admin as never);
    assert.ok(result.inserted > 0);
    assert.equal(result.updated, 0);
    assert.equal(result.deactivated, 0);
    assert.equal(admin.rows.length, result.inserted);
    assert.ok(admin.rows.every((r) => r.layer === "canon"));
    assert.ok(admin.rows.every((r) => r.is_active));
    assert.ok(
      admin.rows.every((r) => r.approved_by_actor_id === CANON_SYNC_ACTOR_ID),
    );
    assert.ok(admin.rows.every((r) => r.source_candidate_id === null));
    assert.ok(admin.rows.every((r) => r.source_message_id === null));
    assert.ok(admin.rows.every((r) => r.source_profile_id === null));
    assert.ok(
      admin.rows.every(
        (r) => typeof r.metadata[CANON_METADATA_KEY] === "string",
      ),
    );
  });

  it("second identical sync is idempotent", async () => {
    const admin = makeMemoryAdmin();
    const first = await syncFennCanon(admin as never);
    const count = admin.rows.length;
    const second = await syncFennCanon(admin as never);
    assert.equal(second.inserted, 0);
    assert.equal(second.updated, 0);
    assert.equal(second.unchanged, first.inserted);
    assert.equal(admin.rows.length, count);
  });

  it("changed content updates the same row identity", async () => {
    const admin = makeMemoryAdmin();
    await syncFennCanon(admin as never);
    const target = admin.rows.find(
      (r) => r.metadata[CANON_METADATA_KEY] === "fenn.identity",
    );
    assert.ok(target);
    const id = target.id;
    target.content = "stale content";

    const result = await syncFennCanon(admin as never);
    assert.equal(result.updated, 1);
    assert.equal(result.inserted, 0);
    const again = admin.rows.find((r) => r.id === id);
    assert.ok(again);
    assert.notEqual(again.content, "stale content");
    assert.match(again.content, /i'm fenn/i);
    assert.equal(again.is_active, true);
  });

  it("removed Canon becomes inactive rather than deleted", async () => {
    const admin = makeMemoryAdmin([
      {
        id: "orphan",
        layer: "canon",
        title: "retired",
        content: "old line",
        is_active: true,
        visibility: "public",
        metadata: { [CANON_METADATA_KEY]: "fenn.retired.example" },
        source_candidate_id: null,
        source_message_id: null,
        source_profile_id: null,
        approved_at: "2026-01-01T00:00:00.000Z",
        approved_by_actor_id: CANON_SYNC_ACTOR_ID,
      },
    ]);

    const result = await syncFennCanon(admin as never);
    assert.ok(result.deactivated >= 1);
    const orphan = admin.rows.find((r) => r.id === "orphan");
    assert.ok(orphan);
    assert.equal(orphan.is_active, false);
    assert.ok(admin.rows.some((r) => r.id === "orphan"));
  });

  it("does not touch greenwood_memory rows", async () => {
    const admin = makeMemoryAdmin([
      {
        id: "gm1",
        layer: "greenwood_memory",
        title: "approved thought",
        content: "from camp",
        is_active: true,
        visibility: "public",
        metadata: {},
        source_candidate_id: "c1",
        source_message_id: "msg1",
        source_profile_id: "p1",
        approved_at: "2026-01-01T00:00:00.000Z",
        approved_by_actor_id: "profile:p1",
      },
    ]);

    await syncFennCanon(admin as never);
    const gm = admin.rows.find((r) => r.id === "gm1");
    assert.ok(gm);
    assert.equal(gm.layer, "greenwood_memory");
    assert.equal(gm.content, "from camp");
    assert.equal(gm.source_profile_id, "p1");
    assert.equal(gm.is_active, true);
  });
});

describe("listActiveCanonMemories", () => {
  it("returns public-safe DTOs without provenance FKs", async () => {
    const admin = makeMemoryAdmin();
    await syncFennCanon(admin as never);
    admin.rows.push({
      id: "inactive",
      layer: "canon",
      title: "gone",
      content: "inactive",
      is_active: false,
      visibility: "public",
      metadata: { [CANON_METADATA_KEY]: "fenn.inactive.example" },
      source_candidate_id: null,
      source_message_id: null,
      source_profile_id: null,
      approved_at: null,
      approved_by_actor_id: CANON_SYNC_ACTOR_ID,
    });

    const listed = await listActiveCanonMemories(admin as never);
    assert.ok(listed.length > 0);
    assert.ok(listed.every((row) => row.isActive));
    assert.equal(
      listed.some((row) => row.key === "fenn.inactive.example"),
      false,
    );
    for (const row of listed) {
      assert.equal("sourceProfileId" in row, false);
      assert.equal("sourceMessageId" in row, false);
      assert.equal("sourceCandidateId" in row, false);
      assert.ok(row.key.startsWith("fenn."));
    }
  });
});
