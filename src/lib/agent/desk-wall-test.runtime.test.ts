import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DESK_WALL_TEST_BODY,
  DESK_WALL_TEST_X_POST_ID,
  deskWallTestSourceExternalId,
  runDeskAgentWallTest,
} from "@/lib/agent/desk-wall-test";

type Row = Record<string, unknown>;

/**
 * Minimal in-memory admin surface for Desk wall-test happy path + idempotency.
 */
function createFakeAdmin() {
  const state = {
    events: [] as Row[],
    judgements: [] as Row[],
    authorizations: [] as Row[],
    effects: [] as Row[],
    wall: [] as Row[],
  };

  function wallChain() {
    const chain: {
      select: (cols: string) => unknown;
      eq: (col: string, val: unknown) => unknown;
      maybeSingle: () => Promise<{ data: Row | null; error: null }>;
      insert: (row: Row) => unknown;
      single: () => Promise<{ data: Row | null; error: null }>;
      _filters: Record<string, unknown>;
      _mode: string;
      _payload?: Row;
    } = {
      _filters: {},
      _mode: "select",
      select() {
        return chain;
      },
      eq(col, val) {
        chain._filters[col] = val;
        return chain;
      },
      async maybeSingle() {
        if (chain._mode === "select") {
          const match = state.wall.find(
            (w) =>
              w.source_type === chain._filters.source_type &&
              w.source_external_id === chain._filters.source_external_id,
          );
          return { data: match ?? null, error: null };
        }
        return { data: null, error: null };
      },
      insert(row) {
        chain._mode = "insert";
        chain._payload = row;
        return chain;
      },
      async single() {
        if (chain._mode === "insert" && chain._payload) {
          const payload = chain._payload;
          const existing = state.wall.find(
            (w) =>
              w.source_type === payload.source_type &&
              w.source_external_id === payload.source_external_id,
          );
          if (existing) {
            // unique violation path not used if write.ts finds first
            return { data: existing, error: null };
          }
          const row = {
            id: `wall-${state.wall.length + 1}`,
            body: payload.body,
            created_at: new Date().toISOString(),
            source_type: payload.source_type,
            source_external_id: payload.source_external_id,
            mark_count: 0,
          };
          state.wall.push(row);
          return { data: row, error: null };
        }
        return { data: null, error: null };
      },
    };
    return chain;
  }

  function from(table: string) {
    if (table === "wall_entries") return wallChain();

    if (table === "x_perception_events") {
      const chain: {
        select: () => unknown;
        eq: (c: string, v: unknown) => unknown;
        maybeSingle: () => Promise<{ data: Row | null; error: null }>;
        insert: (r: Row) => unknown;
        single: () => Promise<{ data: Row | null; error: null }>;
        _filters: Record<string, unknown>;
        _mode: string;
        _payload?: Row;
      } = {
        _filters: {},
        _mode: "select",
        select() {
          return chain;
        },
        eq(c, v) {
          chain._filters[c] = v;
          return chain;
        },
        async maybeSingle() {
          const match = state.events.find(
            (e) => e.x_post_id === chain._filters.x_post_id,
          );
          return { data: match ?? null, error: null };
        },
        insert(r) {
          chain._mode = "insert";
          chain._payload = r;
          return chain;
        },
        async single() {
          const id = `evt-${state.events.length + 1}`;
          const row = { id, ...chain._payload };
          state.events.push(row);
          return { data: row, error: null };
        },
      };
      return chain;
    }

    if (table === "x_perception_judgements") {
      const chain: {
        select: () => unknown;
        eq: (c: string, v: unknown) => unknown;
        maybeSingle: () => Promise<{ data: Row | null; error: null }>;
        insert: (r: Row) => unknown;
        single: () => Promise<{ data: Row | null; error: null }>;
        _filters: Record<string, unknown>;
        _mode: string;
        _payload?: Row;
      } = {
        _filters: {},
        _mode: "select",
        select() {
          return chain;
        },
        eq(c, v) {
          chain._filters[c] = v;
          return chain;
        },
        async maybeSingle() {
          const match = state.judgements.find(
            (j) => j.perception_event_id === chain._filters.perception_event_id,
          );
          return { data: match ?? null, error: null };
        },
        insert(r) {
          chain._mode = "insert";
          chain._payload = r;
          return chain;
        },
        async single() {
          const id = `jud-${state.judgements.length + 1}`;
          const row = { id, ...chain._payload };
          state.judgements.push(row);
          return { data: row, error: null };
        },
      };
      return chain;
    }

    if (table === "x_perception_effects") {
      const chain: {
        select: () => unknown;
        eq: (c: string, v: unknown) => unknown;
        maybeSingle: () => Promise<{ data: Row | null; error: null }>;
        _filters: Record<string, unknown>;
      } = {
        _filters: {},
        select() {
          return chain;
        },
        eq(c, v) {
          chain._filters[c] = v;
          return chain;
        },
        async maybeSingle() {
          const match = state.effects.find(
            (e) => e.idempotency_key === chain._filters.idempotency_key,
          );
          if (!match) return { data: null, error: null };
          return {
            data: {
              id: match.id,
              status: match.status,
              external_result_id: match.external_result_id ?? null,
              completed_at: match.completed_at ?? null,
              updated_at: match.updated_at ?? null,
            },
            error: null,
          };
        },
      };
      return chain;
    }

    throw new Error(`unexpected table ${table}`);
  }

  async function rpc(fn: string, args?: Record<string, unknown>) {
    if (fn === "persist_x_perception_authorization") {
      const perceptionId = String(args?.p_perception_event_id);
      const existing = state.authorizations.find(
        (a) => a.perception_event_id === perceptionId,
      );
      if (existing) {
        const count = state.effects.filter(
          (e) => e.authorization_id === existing.id,
        ).length;
        return {
          data: [
            {
              created: false,
              authorization_id: existing.id,
              outcome: existing.outcome,
              policy_code: existing.policy_code,
              effects_created: count,
            },
          ],
          error: null,
        };
      }
      const authId = `auth-${state.authorizations.length + 1}`;
      state.authorizations.push({
        id: authId,
        perception_event_id: perceptionId,
        judgement_id: args?.p_judgement_id,
        outcome: args?.p_outcome,
        policy_code: args?.p_policy_code,
      });
      const effects = Array.isArray(args?.p_effects) ? args!.p_effects : [];
      for (const e of effects as Array<Record<string, unknown>>) {
        const key = String(e.idempotency_key);
        if (state.effects.some((x) => x.idempotency_key === key)) continue;
        if (e.type === "reply_on_x") {
          throw new Error("test forbid reply effect");
        }
        state.effects.push({
          id: `eff-${state.effects.length + 1}`,
          authorization_id: authId,
          perception_event_id: perceptionId,
          effect_type: e.type,
          idempotency_key: key,
          payload: e.payload,
          status: "pending",
          attempt_count: 0,
          external_result_id: null,
          completed_at: null,
          updated_at: new Date().toISOString(),
        });
      }
      return {
        data: [
          {
            created: true,
            authorization_id: authId,
            outcome: args?.p_outcome,
            policy_code: args?.p_policy_code,
            effects_created: effects.length,
          },
        ],
        error: null,
      };
    }

    if (fn === "claim_x_perception_effect") {
      const xPostId = args?.p_x_post_id
        ? String(args.p_x_post_id).trim()
        : null;
      // Must not claim open queue: only synthetic id is claimable when filtered.
      const candidates = state.effects.filter((e) => {
        const event = state.events.find((ev) => ev.id === e.perception_event_id);
        if (!event) return false;
        if (xPostId && event.x_post_id !== xPostId) return false;
        if (!xPostId) return false; // test path always passes xPostId
        return (
          e.status === "pending" ||
          (e.status === "failed" && e.failure_class === "retryable")
        );
      });
      const effect = candidates[0];
      if (!effect) return { data: [], error: null };
      effect.status = "processing";
      effect.attempt_count = Number(effect.attempt_count ?? 0) + 1;
      const event = state.events.find((ev) => ev.id === effect.perception_event_id)!;
      return {
        data: [
          {
            effect_id: effect.id,
            authorization_id: effect.authorization_id,
            perception_event_id: effect.perception_event_id,
            effect_type: effect.effect_type,
            idempotency_key: effect.idempotency_key,
            payload: effect.payload,
            status: effect.status,
            attempt_count: effect.attempt_count,
            x_post_id: event.x_post_id,
          },
        ],
        error: null,
      };
    }

    if (fn === "complete_x_perception_effect") {
      const id = String(args?.p_effect_id);
      const effect = state.effects.find((e) => e.id === id);
      if (!effect || effect.status !== "processing") {
        return { data: false, error: null };
      }
      effect.status = "completed";
      effect.external_result_id = args?.p_external_result_id;
      effect.completed_at = new Date().toISOString();
      return { data: true, error: null };
    }

    if (fn === "fail_x_perception_effect") {
      const id = String(args?.p_effect_id);
      const effect = state.effects.find((e) => e.id === id);
      if (!effect || effect.status !== "processing") {
        return { data: false, error: null };
      }
      effect.status = "failed";
      effect.failure_class = args?.p_failure_class;
      effect.last_error = args?.p_last_error;
      return { data: true, error: null };
    }

    return { data: null, error: { message: `unknown rpc ${fn}` } };
  }

  // Extra decoy pending effect that must never be claimed without filter.
  state.events.push({
    id: "evt-decoy",
    x_post_id: "1111111111111111111",
  });
  state.effects.push({
    id: "eff-decoy",
    authorization_id: "auth-decoy",
    perception_event_id: "evt-decoy",
    effect_type: "reply_on_x",
    idempotency_key: "1111111111111111111:reply",
    payload: { text: "should not run", replyToXPostId: "1111111111111111111" },
    status: "pending",
    attempt_count: 0,
  });

  return {
    admin: { from, rpc },
    state,
  };
}

describe("Desk Wall-only agent test — runtime (fake admin)", () => {
  it("first run creates wall-only effect and inscription; second is idempotent", async () => {
    const { admin, state } = createFakeAdmin();

    const first = await runDeskAgentWallTest({
      admin: admin as never,
      actorId: "profile:test",
    });
    assert.equal(first.ok, true);
    assert.equal(first.status, "created");
    assert.equal(first.xAttempted, false);
    assert.ok(first.wallEntryId);
    assert.ok(first.effectId);
    assert.equal(state.wall.length, 1);
    assert.equal(state.wall[0]?.body, DESK_WALL_TEST_BODY);
    assert.equal(state.wall[0]?.source_type, "x_agent");
    assert.equal(
      state.wall[0]?.source_external_id,
      deskWallTestSourceExternalId(),
    );

    // Only write_to_wall for test scaffold; decoy reply untouched pending.
    const testEffects = state.effects.filter(
      (e) => e.idempotency_key === deskWallTestSourceExternalId(),
    );
    assert.equal(testEffects.length, 1);
    assert.equal(testEffects[0]?.effect_type, "write_to_wall");
    assert.equal(testEffects[0]?.status, "completed");
    const decoy = state.effects.find((e) => e.id === "eff-decoy");
    assert.equal(decoy?.status, "pending");
    assert.equal(decoy?.effect_type, "reply_on_x");

    // x_post_id reserved
    assert.equal(
      state.events.some((e) => e.x_post_id === DESK_WALL_TEST_X_POST_ID),
      true,
    );

    const second = await runDeskAgentWallTest({
      admin: admin as never,
      actorId: "profile:test",
    });
    assert.equal(second.ok, true);
    assert.equal(second.status, "already_present");
    assert.equal(state.wall.length, 1);
    assert.equal(second.wallEntryId, first.wallEntryId);
    assert.equal(decoy?.status, "pending");
  });
});
