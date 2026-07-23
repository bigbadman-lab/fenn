import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CAMP_DISPLAY_MESSAGE_LIMIT, CAMP_HISTORY_MESSAGE_LIMIT } from "./config";
import { toSafeCampMessage, type CampMessageRow } from "./dto";
import {
  campRequestHashes,
  isCampClientMessageId,
  isCampCharacterSlugParam,
} from "./hash";
import { sendCampMessageBodySchema } from "./request";

const here = dirname(fileURLToPath(import.meta.url));

describe("camp request hashes / clientMessageId", () => {
  it("accepts UUID client ids and rejects junk", () => {
    assert.equal(
      isCampClientMessageId("11111111-1111-4111-8111-111111111111"),
      true,
    );
    assert.equal(isCampClientMessageId("not-a-uuid"), false);
  });

  it("derives distinct user/assistant hashes for the same attempt", () => {
    const a = campRequestHashes({
      profileId: "p1",
      sessionId: "s1",
      clientMessageId: "11111111-1111-4111-8111-111111111111",
    });
    const b = campRequestHashes({
      profileId: "p1",
      sessionId: "s1",
      clientMessageId: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(a.userHash, b.userHash);
    assert.equal(a.assistantHash, b.assistantHash);
    assert.notEqual(a.userHash, a.assistantHash);

    const other = campRequestHashes({
      profileId: "p1",
      sessionId: "s1",
      clientMessageId: "22222222-2222-4222-8222-222222222222",
    });
    assert.notEqual(a.userHash, other.userHash);
  });

  it("same text can use different clientMessageIds (hashes differ)", () => {
    const one = campRequestHashes({
      profileId: "p",
      sessionId: "s",
      clientMessageId: "11111111-1111-4111-8111-111111111111",
    });
    const two = campRequestHashes({
      profileId: "p",
      sessionId: "s",
      clientMessageId: "22222222-2222-4222-8222-222222222222",
    });
    assert.notEqual(one.userHash, two.userHash);
  });
});

describe("sendCampMessageBodySchema", () => {
  it("accepts message + clientMessageId only", () => {
    assert.equal(
      sendCampMessageBodySchema.safeParse({
        message: "hello",
        clientMessageId: "11111111-1111-4111-8111-111111111111",
      }).success,
      true,
    );
  });

  it("rejects profileId, sessionId, reward fields", () => {
    assert.equal(
      sendCampMessageBodySchema.safeParse({
        message: "x",
        clientMessageId: "11111111-1111-4111-8111-111111111111",
        profileId: "p",
      }).success,
      false,
    );
    assert.equal(
      sendCampMessageBodySchema.safeParse({
        message: "x",
        clientMessageId: "11111111-1111-4111-8111-111111111111",
        sessionId: "s",
      }).success,
      false,
    );
    assert.equal(
      sendCampMessageBodySchema.safeParse({
        message: "x",
        clientMessageId: "11111111-1111-4111-8111-111111111111",
        reward: 1,
      }).success,
      false,
    );
  });
});

describe("safe camp message DTO", () => {
  it("maps user/assistant and omits evaluation fields", () => {
    const row: CampMessageRow = {
      id: "m1",
      session_id: "s1",
      profile_id: "p1",
      character_id: "c1",
      role: "assistant",
      content: "keep going",
      reward_recommendation: 2,
      reward_granted: 0,
      quality: 3,
      originality: 2,
      relevance: 2,
      spam_probability: 0.1,
      memory_candidate_flag: true,
      leaf_ledger_id: null,
      client_message_hash: "abc",
      moderation_flags: { evaluationReason: "secret" },
      created_at: "2026-07-23T12:00:00.000Z",
    };
    const safe = toSafeCampMessage(row);
    assert.deepEqual(safe, {
      id: "m1",
      role: "assistant",
      content: "keep going",
      createdAt: "2026-07-23T12:00:00.000Z",
    });
    assert.equal("rewardRecommendation" in (safe as object), false);
    assert.equal("quality" in (safe as object), false);
    assert.equal(toSafeCampMessage({ ...row, role: "system" }), null);
  });
});

describe("camp slug + limits", () => {
  it("recognizes canonical slugs", () => {
    assert.equal(isCampCharacterSlugParam("fenn"), true);
    assert.equal(isCampCharacterSlugParam("wren"), true);
    assert.equal(isCampCharacterSlugParam("rook"), true);
    assert.equal(isCampCharacterSlugParam("shaw"), false);
  });

  it("keeps display and model history limits", () => {
    assert.equal(CAMP_DISPLAY_MESSAGE_LIMIT, 50);
    assert.equal(CAMP_HISTORY_MESSAGE_LIMIT, 20);
  });
});

describe("camp persistence safety (source)", () => {
  it("send-message does not award LEAF or write memory_candidates", () => {
    const source = readFileSync(join(here, "send-message.ts"), "utf8");
    assert.doesNotMatch(source, /awardLeaf\s*\(/);
    assert.doesNotMatch(source, /\.from\(\s*["']memory_candidates["']\s*\)/);
    assert.doesNotMatch(source, /web_search/);
    assert.match(source, /reward_granted:\s*0/);
    assert.match(source, /leaf_ledger_id:\s*null/);
  });

  it("model history remains bounded by Stage 7.1 constant", () => {
    const source = readFileSync(join(here, "send-message.ts"), "utf8");
    assert.match(source, /CAMP_HISTORY_MESSAGE_LIMIT/);
  });
});

describe("sendCampMessage idempotency (in-memory admin)", () => {
  it("reuses completed turn and resumes AI after user-only failure", async () => {
    const { sendCampMessage } = await import("./send-message");

    const state = createMemoryCampStore();
    const profileId = "11111111-1111-4111-8111-111111111111";
    const characterId = "22222222-2222-4222-8222-222222222222";
    const clientMessageId = "33333333-3333-4333-8333-333333333333";

    state.characters.set("fenn", {
      id: characterId,
      slug: "fenn",
      display_name: "FENN",
      prompt_key: "camp.character.fenn",
      is_active: true,
      is_locked: false,
    });

    let aiCalls = 0;
    const callModel = async () => {
      aiCalls += 1;
      return {
        reply: "worth carrying.",
        evaluation: {
          rewardRecommendation: 1,
          memoryCandidate: false,
          quality: 2,
          originality: 2,
          relevance: 2,
          spamProbability: 0.05,
          reason: "idea",
        },
      };
    };

    const first = await sendCampMessage({
      profileId,
      outlawNumber: 7,
      characterSlug: "fenn",
      message: "an idea about the road",
      clientMessageId,
      admin: state.asAdmin() as never,
      callModel,
    });

    assert.equal(first.reused, false);
    assert.equal(aiCalls, 1);
    assert.equal(state.messages.length, 2);
    assert.equal(state.sessions.size, 1);

    const second = await sendCampMessage({
      profileId,
      outlawNumber: 7,
      characterSlug: "fenn",
      message: "an idea about the road",
      clientMessageId,
      admin: state.asAdmin() as never,
      callModel,
    });

    assert.equal(second.reused, true);
    assert.equal(aiCalls, 1);
    assert.equal(state.messages.length, 2);
    assert.equal(second.assistantMessage.content, "worth carrying.");

    // Simulate AI failure after user insert: drop assistant, retry same id.
    state.messages = state.messages.filter((m) => m.role === "user");
    const resumed = await sendCampMessage({
      profileId,
      outlawNumber: 7,
      characterSlug: "fenn",
      message: "an idea about the road",
      clientMessageId,
      admin: state.asAdmin() as never,
      callModel,
    });

    assert.equal(aiCalls, 2);
    assert.equal(state.messages.length, 2);
    assert.equal(resumed.assistantMessage.content, "worth carrying.");
    assert.equal(
      state.messages.find((m) => m.role === "assistant")?.reward_granted,
      0,
    );
    assert.equal(
      state.messages.find((m) => m.role === "assistant")?.leaf_ledger_id,
      null,
    );
  });

  it("different characters get different sessions", async () => {
    const { sendCampMessage } = await import("./send-message");
    const state = createMemoryCampStore();
    const profileId = "11111111-1111-4111-8111-111111111111";

    state.characters.set("fenn", {
      id: "22222222-2222-4222-8222-222222222222",
      slug: "fenn",
      display_name: "FENN",
      prompt_key: "camp.character.fenn",
      is_active: true,
      is_locked: false,
    });
    state.characters.set("wren", {
      id: "33333333-3333-4333-8333-333333333333",
      slug: "wren",
      display_name: "WREN",
      prompt_key: "camp.character.wren",
      is_active: true,
      is_locked: false,
    });

    const callModel = async () => ({
      reply: "ok",
      evaluation: {
        rewardRecommendation: 0,
        memoryCandidate: false,
        quality: 1,
        originality: 1,
        relevance: 1,
        spamProbability: 0.2,
        reason: "ordinary",
      },
    });

    await sendCampMessage({
      profileId,
      outlawNumber: 1,
      characterSlug: "fenn",
      message: "hello fenn",
      clientMessageId: "44444444-4444-4444-8444-444444444444",
      admin: state.asAdmin() as never,
      callModel,
    });
    await sendCampMessage({
      profileId,
      outlawNumber: 1,
      characterSlug: "wren",
      message: "hello wren",
      clientMessageId: "55555555-5555-4555-8555-555555555555",
      admin: state.asAdmin() as never,
      callModel,
    });

    assert.equal(state.sessions.size, 2);
  });

  it("locked character fails closed", async () => {
    const { sendCampMessage } = await import("./send-message");
    const { CampAiError } = await import("./errors");
    const state = createMemoryCampStore();
    state.characters.set("rook", {
      id: "22222222-2222-4222-8222-222222222222",
      slug: "rook",
      display_name: "ROOK",
      prompt_key: "camp.character.rook",
      is_active: true,
      is_locked: true,
    });

    await assert.rejects(
      () =>
        sendCampMessage({
          profileId: "11111111-1111-4111-8111-111111111111",
          outlawNumber: 1,
          characterSlug: "rook",
          message: "signal",
          clientMessageId: "66666666-6666-4666-8666-666666666666",
          admin: state.asAdmin() as never,
          callModel: async () => {
            throw new Error("should not call");
          },
        }),
      (err: unknown) =>
        err instanceof CampAiError && err.code === "camp_character_locked",
    );
  });
});

type CharRow = {
  id: string;
  slug: string;
  display_name: string;
  prompt_key: string;
  is_active: boolean;
  is_locked: boolean;
};

type MsgRow = {
  id: string;
  session_id: string;
  profile_id: string;
  character_id: string;
  role: string;
  content: string;
  reward_recommendation: number | null;
  reward_granted: number;
  quality: number | null;
  originality: number | null;
  relevance: number | null;
  spam_probability: number | null;
  memory_candidate_flag: boolean;
  leaf_ledger_id: string | null;
  client_message_hash: string | null;
  moderation_flags: Record<string, unknown>;
  created_at: string;
};

type SessRow = {
  id: string;
  profile_id: string;
  character_id: string;
  started_at: string;
  last_message_at: string | null;
  message_count: number;
  is_open: boolean;
  created_at: string;
  updated_at: string;
};

function createMemoryCampStore() {
  const characters = new Map<string, CharRow>();
  const sessions = new Map<string, SessRow>();
  let messages: MsgRow[] = [];
  let seq = 0;
  const now = () => new Date().toISOString();
  const id = () => {
    seq += 1;
    return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  };

  function sessionKey(profileId: string, characterId: string) {
    return `${profileId}:${characterId}`;
  }

  function asAdmin() {
    return {
      from(table: string) {
        if (table === "camp_characters") {
          return {
            select() {
              return {
                eq(_col: string, slug: string) {
                  return {
                    async maybeSingle() {
                      const row = characters.get(slug) ?? null;
                      return { data: row, error: null };
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "camp_sessions") {
          return {
            select() {
              return {
                eq(col1: string, v1: string) {
                  return {
                    eq(col2: string, v2: string) {
                      return {
                        async maybeSingle() {
                          const profileId = col1 === "profile_id" ? v1 : v2;
                          const characterId = col1 === "character_id" ? v1 : v2;
                          const row =
                            sessions.get(sessionKey(profileId, characterId)) ??
                            null;
                          return { data: row, error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
            insert(values: Record<string, unknown>) {
              const key = sessionKey(
                String(values.profile_id),
                String(values.character_id),
              );
              if (sessions.has(key)) {
                return {
                  select() {
                    return {
                      async single() {
                        return {
                          data: null,
                          error: { code: "23505", message: "duplicate" },
                        };
                      },
                    };
                  },
                };
              }
              const row: SessRow = {
                id: id(),
                profile_id: String(values.profile_id),
                character_id: String(values.character_id),
                started_at: now(),
                last_message_at: null,
                message_count: Number(values.message_count ?? 0),
                is_open: Boolean(values.is_open ?? true),
                created_at: now(),
                updated_at: now(),
              };
              sessions.set(key, row);
              return {
                select() {
                  return {
                    async single() {
                      return { data: row, error: null };
                    },
                  };
                },
              };
            },
            update(values: Record<string, unknown>) {
              return {
                eq(_col: string, sessionId: string) {
                  for (const row of sessions.values()) {
                    if (row.id === sessionId) {
                      Object.assign(row, values, { updated_at: now() });
                    }
                  }
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        }

        if (table === "camp_messages") {
          return {
            select(_cols?: string, opts?: { count?: string; head?: boolean }) {
              const filters: Array<(m: MsgRow) => boolean> = [];
              let orderDesc = false;
              let limitN: number | null = null;
              const api = {
                eq(col: string, value: string) {
                  filters.push((m) => (m as Record<string, unknown>)[col] === value);
                  return api;
                },
                in(col: string, values: string[]) {
                  filters.push((m) =>
                    values.includes(String((m as Record<string, unknown>)[col])),
                  );
                  return api;
                },
                order(_col: string, opts?: { ascending?: boolean }) {
                  orderDesc = opts?.ascending === false;
                  return api;
                },
                limit(n: number) {
                  limitN = n;
                  return api;
                },
                async maybeSingle() {
                  const rows = messages.filter((m) =>
                    filters.every((f) => f(m)),
                  );
                  return { data: rows[0] ?? null, error: null };
                },
                then(
                  resolve: (value: {
                    data: MsgRow[] | null;
                    error: null;
                    count?: number;
                  }) => void,
                ) {
                  let rows = messages.filter((m) => filters.every((f) => f(m)));
                  if (opts?.count === "exact" && opts.head) {
                    resolve({ data: null, error: null, count: rows.length });
                    return;
                  }
                  rows = [...rows].sort((a, b) =>
                    orderDesc
                      ? b.created_at.localeCompare(a.created_at)
                      : a.created_at.localeCompare(b.created_at),
                  );
                  if (limitN != null) rows = rows.slice(0, limitN);
                  resolve({ data: rows, error: null });
                },
              };
              return api;
            },
            insert(values: Record<string, unknown>) {
              const hash = values.client_message_hash
                ? String(values.client_message_hash)
                : null;
              if (
                hash &&
                messages.some(
                  (m) =>
                    m.session_id === values.session_id &&
                    m.client_message_hash === hash,
                )
              ) {
                return {
                  select() {
                    return {
                      async single() {
                        return {
                          data: null,
                          error: { code: "23505", message: "duplicate" },
                        };
                      },
                    };
                  },
                };
              }
              const row: MsgRow = {
                id: id(),
                session_id: String(values.session_id),
                profile_id: String(values.profile_id),
                character_id: String(values.character_id),
                role: String(values.role),
                content: String(values.content),
                reward_recommendation:
                  (values.reward_recommendation as number | null) ?? null,
                reward_granted: Number(values.reward_granted ?? 0),
                quality: (values.quality as number | null) ?? null,
                originality: (values.originality as number | null) ?? null,
                relevance: (values.relevance as number | null) ?? null,
                spam_probability:
                  (values.spam_probability as number | null) ?? null,
                memory_candidate_flag: Boolean(
                  values.memory_candidate_flag ?? false,
                ),
                leaf_ledger_id: (values.leaf_ledger_id as string | null) ?? null,
                client_message_hash: hash,
                moderation_flags:
                  (values.moderation_flags as Record<string, unknown>) ?? {},
                created_at: now(),
              };
              messages.push(row);
              return {
                select() {
                  return {
                    async single() {
                      return { data: row, error: null };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`unexpected table ${table}`);
      },
    };
  }

  return {
    characters,
    sessions,
    get messages() {
      return messages;
    },
    set messages(next: MsgRow[]) {
      messages = next;
    },
    asAdmin,
  };
}
