import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CAMP_EMPTY_CONVERSATION_PROMPTS } from "./config";
import { toSafeCampMessage, type CampMessageRow } from "./dto";
import { campRequestHashes } from "./hash";
import { normalizeCampEvaluation } from "./normalize-evaluation";

const here = dirname(fileURLToPath(import.meta.url));

describe("Camp memory candidate service", () => {
  it("creates pending candidate from paired user content", async () => {
    const { createMemoryCandidateFromCampMessage } = await import(
      "./memory-candidate"
    );
    const store = createMemoryStore();
    const profileId = "11111111-1111-4111-8111-111111111111";
    const characterId = "22222222-2222-4222-8222-222222222222";
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const clientMessageId = "44444444-4444-4444-8444-444444444444";
    const { userHash, assistantHash } = campRequestHashes({
      profileId,
      sessionId,
      clientMessageId,
    });

    const user = store.addMessage({
      session_id: sessionId,
      profile_id: profileId,
      character_id: characterId,
      role: "user",
      content: "Greenwood thresholds should reward participation.",
      client_message_hash: userHash,
      memory_candidate_flag: false,
      moderation_flags: { clientMessageId },
    });
    const assistant = store.addMessage({
      session_id: sessionId,
      profile_id: profileId,
      character_id: characterId,
      role: "assistant",
      content: "worth carrying.",
      client_message_hash: assistantHash,
      memory_candidate_flag: true,
      moderation_flags: {
        clientMessageId,
        pairedUserMessageId: user.id,
      },
    });

    const first = await createMemoryCandidateFromCampMessage({
      messageId: assistant.id,
      admin: store.asAdmin() as never,
    });

    assert.equal(first.created, true);
    assert.equal(first.reason, "created");
    assert.equal(first.candidate?.status, "pending");
    assert.equal(first.candidate?.resulting_memory_id, null);
    assert.equal(
      first.candidate?.content,
      "Greenwood thresholds should reward participation.",
    );
    assert.equal(first.candidate?.profile_id, profileId);
    assert.equal(first.candidate?.character_id, characterId);
    assert.equal(first.candidate?.camp_message_id, assistant.id);
    assert.equal(store.candidates.length, 1);

    const second = await createMemoryCandidateFromCampMessage({
      messageId: assistant.id,
      admin: store.asAdmin() as never,
    });
    assert.equal(second.created, false);
    assert.equal(second.reason, "already_exists");
    assert.equal(second.candidate?.id, first.candidate?.id);
    assert.equal(store.candidates.length, 1);
  });

  it("skips when memory_candidate_flag is false", async () => {
    const { createMemoryCandidateFromCampMessage } = await import(
      "./memory-candidate"
    );
    const store = createMemoryStore();
    const assistant = store.addMessage({
      session_id: "s",
      profile_id: "p",
      character_id: "c",
      role: "assistant",
      content: "hello",
      client_message_hash: "h",
      memory_candidate_flag: false,
      moderation_flags: {},
    });
    const out = await createMemoryCandidateFromCampMessage({
      messageId: assistant.id,
      admin: store.asAdmin() as never,
    });
    assert.equal(out.skipped, true);
    assert.equal(out.reason, "not_flagged");
    assert.equal(store.candidates.length, 0);
  });

  it("skips when hash pairing cannot be resolved", async () => {
    const { createMemoryCandidateFromCampMessage } = await import(
      "./memory-candidate"
    );
    const store = createMemoryStore();
    const assistant = store.addMessage({
      session_id: "s",
      profile_id: "p",
      character_id: "c",
      role: "assistant",
      content: "hello",
      client_message_hash: "h",
      memory_candidate_flag: true,
      moderation_flags: {},
    });
    const out = await createMemoryCandidateFromCampMessage({
      messageId: assistant.id,
      admin: store.asAdmin() as never,
    });
    assert.equal(out.reason, "pairing_failed");
    assert.equal(store.candidates.length, 0);
  });

  it("normalized weak/gaming evaluation never flags candidate", () => {
    const out = normalizeCampEvaluation({
      raw: {
        rewardRecommendation: 2,
        memoryCandidate: true,
        quality: 3,
        originality: 3,
        relevance: 3,
        spamProbability: 0.1,
        reason: "x",
      },
      signals: {
        repeatedContent: true,
        repetitionSimilarity: 1,
        rewardGaming: false,
      },
    });
    assert.equal(out.evaluation.memoryCandidate, false);
  });
});

describe("Camp memory source safety", () => {
  it("memory-candidate never writes fenn_memories or embeddings", () => {
    const source = readFileSync(join(here, "memory-candidate.ts"), "utf8");
    assert.doesNotMatch(source, /\.from\(\s*["']fenn_memories["']\s*\)/);
    assert.doesNotMatch(source, /embedding/);
    assert.doesNotMatch(source, /web_search/);
    assert.match(source, /status:\s*["']pending["']/);
    assert.match(source, /resulting_memory_id:\s*null/);
  });

  it("send-message creates candidates best-effort and never exposes them", () => {
    const source = readFileSync(join(here, "send-message.ts"), "utf8");
    assert.match(source, /createMemoryCandidateFromCampMessage/);
    assert.match(source, /applyMemoryCandidate/);
    assert.doesNotMatch(source, /\.from\(\s*["']fenn_memories["']\s*\)/);
    assert.doesNotMatch(source, /profiles\.leaf_balance/);
  });

  it("SafeCampMessage never includes memory candidate fields", () => {
    const safe = toSafeCampMessage({
      id: "m",
      session_id: "s",
      profile_id: "p",
      character_id: "c",
      role: "assistant",
      content: "ok",
      reward_recommendation: 1,
      reward_granted: 0,
      quality: 2,
      originality: 2,
      relevance: 2,
      spam_probability: 0.1,
      memory_candidate_flag: true,
      leaf_ledger_id: null,
      client_message_hash: "h",
      moderation_flags: { clientMessageId: "x" },
      created_at: "2026-07-23T12:00:00.000Z",
    });
    assert.equal(safe?.content, "ok");
    assert.equal("memoryCandidate" in (safe as object), false);
    assert.equal("memory_candidate_flag" in (safe as object), false);
  });

  it("empty conversation prompts are character-specific and static", () => {
    assert.equal(
      CAMP_EMPTY_CONVERSATION_PROMPTS.fenn,
      "say something worth carrying.",
    );
    assert.equal(
      CAMP_EMPTY_CONVERSATION_PROMPTS.wren,
      "speak. she is listening.",
    );
    assert.equal(CAMP_EMPTY_CONVERSATION_PROMPTS.rook, "what did you see?");
  });
});

type CandidateRow = {
  id: string;
  profile_id: string;
  character_id: string | null;
  camp_message_id: string | null;
  content: string;
  status: string;
  resulting_memory_id: string | null;
  created_at: string;
};

function createMemoryStore() {
  const messages: CampMessageRow[] = [];
  const candidates: CandidateRow[] = [];
  let seq = 0;
  const nextId = () => {
    seq += 1;
    return `aaaaaaaa-aaaa-4aaa-8aaa-${String(seq).padStart(12, "0")}`;
  };

  function addMessage(
    partial: Pick<
      CampMessageRow,
      | "session_id"
      | "profile_id"
      | "character_id"
      | "role"
      | "content"
      | "client_message_hash"
      | "memory_candidate_flag"
      | "moderation_flags"
    >,
  ): CampMessageRow {
    const row: CampMessageRow = {
      id: nextId(),
      session_id: partial.session_id,
      profile_id: partial.profile_id,
      character_id: partial.character_id,
      role: partial.role,
      content: partial.content,
      reward_recommendation: null,
      reward_granted: 0,
      quality: null,
      originality: null,
      relevance: null,
      spam_probability: null,
      memory_candidate_flag: partial.memory_candidate_flag,
      leaf_ledger_id: null,
      client_message_hash: partial.client_message_hash,
      moderation_flags: partial.moderation_flags,
      created_at: new Date().toISOString(),
    };
    messages.push(row);
    return row;
  }

  function messageQuery(filters: Record<string, string>) {
    const api = {
      eq(col: string, value: string) {
        return messageQuery({ ...filters, [col]: value });
      },
      async maybeSingle() {
        const row =
          messages.find((m) =>
            Object.entries(filters).every(([k, v]) => {
              if (k === "id") return m.id === v;
              if (k === "session_id") return m.session_id === v;
              if (k === "profile_id") return m.profile_id === v;
              if (k === "client_message_hash") {
                return m.client_message_hash === v;
              }
              return false;
            }),
          ) ?? null;
        return { data: row, error: null };
      },
    };
    return api;
  }

  function asAdmin() {
    return {
      from(table: string) {
        if (table === "camp_messages") {
          return {
            select() {
              return messageQuery({});
            },
          };
        }
        if (table === "memory_candidates") {
          return {
            select() {
              return {
                eq(col: string, value: string) {
                  return {
                    async maybeSingle() {
                      const row =
                        candidates.find((c) => {
                          if (col === "camp_message_id") {
                            return c.camp_message_id === value;
                          }
                          return false;
                        }) ?? null;
                      return { data: row, error: null };
                    },
                  };
                },
              };
            },
            insert(values: Record<string, unknown>) {
              const campMessageId = values.camp_message_id as string;
              if (candidates.some((c) => c.camp_message_id === campMessageId)) {
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
              const row: CandidateRow = {
                id: nextId(),
                profile_id: values.profile_id as string,
                character_id: (values.character_id as string) ?? null,
                camp_message_id: campMessageId,
                content: values.content as string,
                status: (values.status as string) ?? "pending",
                resulting_memory_id:
                  (values.resulting_memory_id as string | null) ?? null,
                created_at: new Date().toISOString(),
              };
              candidates.push(row);
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

  return { messages, candidates, addMessage, asAdmin };
}
