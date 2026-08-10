/**
 * Stage 2 — response mode, public facts, routing, grounding, recovery parity.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPublicFactEvidencePromptBlock,
  assertPublicFactEvidenceSafe,
  PUBLIC_FACT_KEYS,
  type PublicFactEvidence,
} from "@/lib/agent/public-fact-evidence";
import {
  readConfirmedOutlawCount,
  readCurrentPublicGathering,
  readGreenwoodLeafThreshold,
  readGreenwoodMemberCount,
  readLatestPublicChronicle,
  readOfficialFennToken,
} from "@/lib/agent/public-fact-readers";
import {
  draftAssertsUnsupportedPublicQuantity,
  inferStage124CapabilitiesFromBody,
  resolveExecutableLiveCapabilities,
} from "@/lib/agent/live-capability-routing";
import {
  STAGE12_RESPONSE_MODES,
  inferResponseModeFromBody,
  normalizeResponseMode,
} from "@/lib/agent/response-mode";
import {
  normalizeJudgementIntention,
  parseJudgementModelOutput,
  stage12JudgementModelSchema,
} from "@/lib/agent/judge-schema";
import {
  STAGE12_JUDGE_OPENAI_MODEL,
  STAGE12_JUDGE_PROMPT_VERSION,
} from "@/lib/agent/judge-config";
import { FENN_LIVE_CAPABILITIES } from "@/lib/agent/live-state";
import {
  STAGE124_LIVE_CAPABILITIES,
} from "@/lib/agent/stage124-live-capabilities";
import { buildFennPublicFinalJudgeSystemPrompt } from "@/lib/agent/stage124-final-judge-prompt";
import { buildReplyRecoveryUserPayload } from "@/lib/agent/reply-recovery-prompt";
import {
  ensureReplyTextWithRecovery,
  intentionNeedsReplyRecovery,
} from "@/lib/agent/reply-recovery";
import { finalizeOneXPerceptionJudgementWithLiveState } from "@/lib/agent/stage124-sight";
import type { Stage124LiveCapability } from "@/lib/agent/stage124-live-capabilities";
import type { PublicAgentKnowledgeLookup } from "@/lib/agent/knowledge";
import type { Stage124FinalJudgementIntention } from "@/lib/agent/stage124-final-judgement-schema";
import { isHardBlockReasonCode } from "@/lib/agent/reply-guarantee-policy";

function makeAdmin(seed: {
  claim?: Record<string, unknown> | null;
}) {
  const claimRow =
    seed.claim ??
    ({
      perception_event_id: "e1",
      x_post_id: "x1",
      perception_type: "mention",
      author_x_user_id: "au1",
      author_username: "q",
      body: "Are there many Outlaws?",
      x_created_at: "2026-07-26T00:00:00.000Z",
      initial_action: "reply_on_x",
      initial_reason_code: "answered_from_public_knowledge",
      initial_engage: true,
      initial_reply_text:
        "Yes, there are many Outlaws, each contributing differently to the fabric of FENN.",
      initial_wall_body: null,
      needs_live_state: [],
      identity_unverified: false,
      knowledge_available: true,
      initial_model: STAGE12_JUDGE_OPENAI_MODEL,
      initial_prompt_version: "fenn-public-judge-v1",
      already_finalized: false,
    }) satisfies Record<string, unknown>;

  const finalizeCalls: unknown[] = [];

  return {
    get finalizeCalls() {
      return finalizeCalls;
    },
    from() {
      throw new Error("from() not used");
    },
    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === "claim_x_perception_judgement_for_live_state") {
        return { data: seed.claim === null ? [] : [claimRow], error: null };
      }
      if (fn === "finalize_x_perception_judgement_with_live_state") {
        finalizeCalls.push(args);
        return { data: [{ created: true }], error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
}

describe("Stage 2 responseMode", () => {
  it("schema accepts four responseMode values", () => {
    assert.deepEqual([...STAGE12_RESPONSE_MODES], [
      "fact",
      "canon",
      "creation",
      "judgement",
    ]);
    for (const mode of STAGE12_RESPONSE_MODES) {
      const parsed = stage12JudgementModelSchema.safeParse({
        engage: true,
        action: "reply_on_x",
        reasonCode: "answered_from_public_knowledge",
        replyText: "ok",
        wallBody: null,
        needsLiveState: [],
        identityUnverified: false,
        responseMode: mode,
      });
      assert.equal(parsed.success, true, mode);
    }
  });

  it("normalizes missing responseMode via parse helper", () => {
    const out = parseJudgementModelOutput({
      engage: true,
      action: "reply_on_x",
      reasonCode: "answered_from_public_knowledge",
      replyText: "ok",
      wallBody: null,
      needsLiveState: [],
      identityUnverified: false,
    });
    assert.equal(out.responseMode, "canon");
  });

  it("classifies fact / canon / creation / judgement bodies", () => {
    assert.equal(
      inferResponseModeFromBody("Are there many Outlaws?"),
      "fact",
    );
    assert.equal(
      inferResponseModeFromBody("How many LEAF for Greenwood?"),
      "fact",
    );
    assert.equal(inferResponseModeFromBody("What is the Greenwood?"), "canon");
    assert.equal(
      inferResponseModeFromBody(
        "What law should be carved above the Greenwood?",
      ),
      "creation",
    );
    assert.equal(
      inferResponseModeFromBody("What matters here?"),
      "judgement",
    );
  });

  it("creation mode clears unnecessary needsLiveState", () => {
    const intention = normalizeJudgementIntention({
      raw: {
        engage: true,
        action: "reply_on_x",
        reasonCode: "creative_world_action",
        replyText: "Leave the Greenwood richer than you found it.",
        wallBody: null,
        needsLiveState: ["treasury"],
        identityUnverified: false,
        responseMode: "creation",
      },
      knowledgeAvailable: true,
      model: STAGE12_JUDGE_OPENAI_MODEL,
      promptVersion: STAGE12_JUDGE_PROMPT_VERSION,
    });
    assert.equal(intention.responseMode, "creation");
    assert.deepEqual(intention.needsLiveState, []);
  });
});

describe("Stage 2 public fact readers", () => {
  it("confirmed Outlaw reader returns canonical count", async () => {
    const admin = {
      from() {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ count: 2, error: null });
              },
            };
          },
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fact = await readConfirmedOutlawCount({ admin: admin as any });
    assert.equal(fact.available, true);
    assert.equal(fact.value, 2);
    assert.equal(fact.key, "confirmed_outlaw_count");
    assert.equal(fact.privacy, "public_aggregate");
  });

  it("Greenwood member reader returns canonical count", async () => {
    const admin = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  not() {
                    return Promise.resolve({ count: 1, error: null });
                  },
                };
              },
            };
          },
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fact = await readGreenwoodMemberCount({ admin: admin as any });
    assert.equal(fact.available, true);
    assert.equal(fact.value, 1);
  });

  it("threshold reader uses configured source", async () => {
    const fact = await readGreenwoodLeafThreshold({
      loadThreshold: async () => 30,
    });
    assert.equal(fact.available, true);
    assert.equal(fact.value, 30);
    assert.equal(fact.privacy, "public_config");
  });

  it("token reader uses official public token source", async () => {
    const fact = await readOfficialFennToken({
      loadToken: async () => ({
        symbol: "FENN",
        chainId: 4663,
        contractAddress: "0x" + "ab".repeat(20),
        explorerUrl: "https://example.invalid/token",
      }),
    });
    assert.equal(fact.available, true);
    assert.equal(fact.value, true);
    assert.match(String(fact.detail), /contract=0x/);
    assert.doesNotMatch(String(fact.detail), /email|privy|leaf_balance/i);
  });

  it("unavailable facts fail closed", async () => {
    const admin = {
      from() {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  count: null,
                  error: { message: "boom" },
                });
              },
            };
          },
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fact = await readConfirmedOutlawCount({ admin: admin as any });
    assert.equal(fact.available, false);
    assert.equal(fact.value, null);

    const thr = await readGreenwoodLeafThreshold({
      loadThreshold: async () => null,
    });
    assert.equal(thr.available, false);

    const tok = await readOfficialFennToken({ loadToken: async () => null });
    assert.equal(tok.available, false);
  });

  it("malformed count is unavailable", async () => {
    const admin = {
      from() {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ count: 1.5, error: null });
              },
            };
          },
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fact = await readConfirmedOutlawCount({ admin: admin as any });
    assert.equal(fact.available, false);
  });

  it("gathering and chronicle readers are public-safe", async () => {
    const g = await readCurrentPublicGathering({
      loadGathering: async () => ({
        active: false,
        serverNow: "2026-08-06T00:00:00.000Z",
      }),
    });
    assert.equal(g.available, true);
    assert.equal(g.value, false);

    const c = await readLatestPublicChronicle({
      loadEntries: async () => [],
    });
    assert.equal(c.available, true);
    assert.equal(c.value, false);
  });

  it("no private fields enter evidence (denylist)", () => {
    const good: PublicFactEvidence = {
      key: "confirmed_outlaw_count",
      available: true,
      value: 2,
      observedAt: "2026-08-06T00:00:00.000Z",
      source: "test",
      privacy: "public_aggregate",
    };
    assertPublicFactEvidenceSafe([good]);
    assert.throws(() =>
      assertPublicFactEvidenceSafe([
        {
          ...good,
          detail: "alias=bob leaf_balance=9",
        },
      ]),
    );
  });

  it("PUBLIC_FACT_KEYS cover Stage 2 seven facts plus launch funding", () => {
    assert.deepEqual([...PUBLIC_FACT_KEYS], [
      "confirmed_outlaw_count",
      "greenwood_member_count",
      "greenwood_leaf_threshold",
      "official_fenn_token",
      "fenn_launch_purse_funding",
      "current_public_gathering",
      "latest_public_chronicle",
    ]);
  });
});

describe("Stage 2 live capability routing", () => {
  it("FENN and STAGE124 allow-lists stay aligned (no silent drops)", () => {
    assert.deepEqual(
      [...FENN_LIVE_CAPABILITIES].sort(),
      [...STAGE124_LIVE_CAPABILITIES].sort(),
    );
  });

  it("Outlaw quantity question selects register", () => {
    assert.deepEqual(
      inferStage124CapabilitiesFromBody("Are there many Outlaws?"),
      ["register"],
    );
  });

  it("LEAF threshold question selects greenwood", () => {
    assert.ok(
      inferStage124CapabilitiesFromBody(
        "How many LEAF do I need for the Greenwood?",
      ).includes("greenwood"),
    );
  });

  it("token launch/address question selects token", () => {
    assert.ok(
      inferStage124CapabilitiesFromBody(
        "Has the official FENN token launched?",
      ).includes("token"),
    );
  });

  it("Gathering question selects gatherings", () => {
    assert.deepEqual(
      inferStage124CapabilitiesFromBody("Is there a Gathering open?"),
      ["gatherings"],
    );
  });

  it("Chronicle question selects chronicle", () => {
    assert.ok(
      inferStage124CapabilitiesFromBody(
        "What is the latest Chronicle entry?",
      ).includes("chronicle"),
    );
  });

  it("creative and judgement do not force live from empty request", () => {
    assert.deepEqual(
      resolveExecutableLiveCapabilities({
        requested: [],
        body: "What law should be carved above the Greenwood?",
        responseMode: "creation",
        inferFromBodyIfEmpty: true,
      }),
      [],
    );
    assert.deepEqual(
      resolveExecutableLiveCapabilities({
        requested: [],
        body: "What matters here?",
        responseMode: "judgement",
        inferFromBodyIfEmpty: true,
      }),
      [],
    );
  });

  it("selected register is not discarded", () => {
    const caps = resolveExecutableLiveCapabilities({
      requested: ["register", "leaf" as never],
      body: "Are there many Outlaws?",
      responseMode: "fact",
    });
    assert.deepEqual(caps, ["register"]);
  });
});

describe("Stage 2 final judge grounding + recovery parity", () => {
  it("final judge system prompt requires exact public facts", () => {
    const sys = buildFennPublicFinalJudgeSystemPrompt();
    assert.match(sys, /Never alter numbers/i);
    assert.match(sys, /approved FENN public source-of-truth/i);
    assert.match(sys, /within the FENN world/i);
  });

  it("structured evidence block preserves exact count", () => {
    const block = buildPublicFactEvidencePromptBlock([
      {
        key: "confirmed_outlaw_count",
        available: true,
        value: 2,
        observedAt: "2026-08-06T12:00:00.000Z",
        source: "test",
        privacy: "public_aggregate",
      },
    ]);
    assert.match(block, /confirmed_outlaw_count/);
    assert.match(block, /value: 2/);
    assert.match(block, /available: true/);
  });

  it("recovery user payload receives the same fact evidence", () => {
    const facts = buildPublicFactEvidencePromptBlock([
      {
        key: "confirmed_outlaw_count",
        available: true,
        value: 2,
        observedAt: "2026-08-06T12:00:00.000Z",
        source: "test",
        privacy: "public_aggregate",
      },
    ]);
    const user = buildReplyRecoveryUserPayload({
      xPostId: "1",
      perceptionType: "mention",
      authorXUserId: "a",
      authorUsername: null,
      body: "Are there many Outlaws?",
      policyOutcome: "reply_only",
      wallBody: null,
      publicFactEvidenceBlock: facts,
    });
    assert.match(user, /TRUSTED PUBLIC FACTS/);
    assert.match(user, /value: 2/);
  });

  it("recovery with confirmed_outlaw_count = 2 uses evidence", async () => {
    const facts = buildPublicFactEvidencePromptBlock([
      {
        key: "confirmed_outlaw_count",
        available: true,
        value: 2,
        observedAt: "2026-08-06T12:00:00.000Z",
        source: "test",
        privacy: "public_aggregate",
      },
    ]);
    let sawFacts = false;
    const result = await ensureReplyTextWithRecovery({
      action: "reply_on_x",
      reasonCode: "requires_live_state",
      replyText: null,
      wallBody: null,
      xPostId: "1",
      perceptionType: "mention",
      authorXUserId: "a",
      authorUsername: null,
      body: "Are there many Outlaws?",
      publicFactEvidenceBlock: facts,
      callModel: async ({ user }) => {
        sawFacts = user.includes("value: 2");
        return { replyText: "Two Outlaws are confirmed in the Register." };
      },
    });
    assert.equal(result.status, "succeeded");
    assert.equal(sawFacts, true);
    assert.match(result.replyText ?? "", /Two/);
  });

  it("recovery with unavailable register is honest", async () => {
    const facts = buildPublicFactEvidencePromptBlock([
      {
        key: "confirmed_outlaw_count",
        available: false,
        value: null,
        observedAt: "2026-08-06T12:00:00.000Z",
        source: "test",
        privacy: "public_aggregate",
      },
    ]);
    const result = await ensureReplyTextWithRecovery({
      action: "reply_on_x",
      reasonCode: "insufficient_knowledge",
      replyText: null,
      wallBody: null,
      xPostId: "1",
      perceptionType: "mention",
      authorXUserId: "a",
      authorUsername: null,
      body: "Are there many Outlaws?",
      knowledgeBoundaryNote: "Register unavailable.",
      publicFactEvidenceBlock: facts,
      callModel: async () => ({
        replyText: "I cannot establish how many names the Register keeps.",
      }),
    });
    assert.equal(result.status, "succeeded");
    assert.doesNotMatch(result.replyText ?? "", /\bmany Outlaws\b/i);
  });

  it("creative recovery without live facts still drafts", async () => {
    const result = await ensureReplyTextWithRecovery({
      action: "reply_on_x",
      reasonCode: "creative_world_action",
      replyText: null,
      wallBody: null,
      xPostId: "1",
      perceptionType: "mention",
      authorXUserId: "a",
      authorUsername: null,
      body: "Write an Outlaw proverb.",
      callModel: async () => ({
        replyText: "Leave the road cleaner than you found it.",
      }),
    });
    assert.equal(result.status, "succeeded");
  });

  it("hard blocks remain unrecoverable", () => {
    assert.equal(isHardBlockReasonCode("spam_or_noise"), true);
    assert.equal(isHardBlockReasonCode("unsafe_or_injection"), true);
    assert.equal(
      intentionNeedsReplyRecovery({
        action: "do_nothing",
        reasonCode: "spam_or_noise",
        replyText: null,
      }),
      false,
    );
  });
});

describe("Stage 2 copy-forward + sight grounding", () => {
  it("copy-forward does not preserve unsupported many Outlaws draft", async () => {
    const admin = makeAdmin({});
    let recoveryUser = "";
    const result = await finalizeOneXPerceptionJudgementWithLiveState({
      admin,
      executeLiveReads: async (caps) => {
        assert.ok(caps.includes("register"));
        return {
          results: [
            {
              capability: "register" as Stage124LiveCapability,
              available: false,
              context: null,
              facts: [
                {
                  key: "confirmed_outlaw_count",
                  available: false,
                  value: null,
                  observedAt: "2026-08-06T00:00:00.000Z",
                  source: "test",
                  privacy: "public_aggregate",
                },
              ],
            },
          ],
          succeeded: [],
          failed: ["register" as Stage124LiveCapability],
          facts: [
            {
              key: "confirmed_outlaw_count",
              available: false,
              value: null,
              observedAt: "2026-08-06T00:00:00.000Z",
              source: "test",
              privacy: "public_aggregate",
            },
          ],
        };
      },
      runFinalJudgement: async () => {
        throw new Error("should not final-judge when all live failed");
      },
      callReplyRecovery: async ({ user }) => {
        recoveryUser = user;
        return {
          replyText:
            "I cannot establish how many names the Register keeps right now.",
        };
      },
    });

    assert.equal(result.status, "finalized");
    const args = admin.finalizeCalls[0] as Record<string, unknown>;
    assert.equal(args.p_final_action, "reply_on_x");
    assert.equal(args.p_final_reason_code, "insufficient_knowledge");
    assert.doesNotMatch(
      String(args.p_final_reply_text),
      /Yes, there are many Outlaws/i,
    );
    assert.doesNotMatch(String(args.p_final_reply_text), /\bmany Outlaws\b/i);
    assert.match(recoveryUser, /unavailable|cannot establish|Register/i);
  });

  it("register evidence grounds final judge and preserves exact number", async () => {
    const admin = makeAdmin({
      claim: {
        perception_event_id: "e1",
        x_post_id: "x1",
        perception_type: "mention",
        author_x_user_id: "au1",
        author_username: "q",
        body: "Are there many Outlaws?",
        x_created_at: "2026-07-26T00:00:00.000Z",
        initial_action: "do_nothing",
        initial_reason_code: "requires_live_state",
        initial_engage: false,
        initial_reply_text: null,
        initial_wall_body: null,
        needs_live_state: ["register"],
        identity_unverified: false,
        knowledge_available: true,
        initial_model: STAGE12_JUDGE_OPENAI_MODEL,
        initial_prompt_version: "fenn-public-judge-v1",
        already_finalized: false,
      },
    });

    let finalUser = "";
    let recoveryUser = "";
    const result = await finalizeOneXPerceptionJudgementWithLiveState({
      admin,
      executeLiveReads: async (caps) => {
        assert.deepEqual(caps, ["register"]);
        const facts: PublicFactEvidence[] = [
          {
            key: "confirmed_outlaw_count",
            available: true,
            value: 2,
            observedAt: "2026-08-06T00:00:00.000Z",
            source: "test",
            privacy: "public_aggregate",
          },
        ];
        return {
          results: [
            {
              capability: "register",
              available: true,
              context: "key=confirmed_outlaw_count; value=2",
              facts,
            },
          ],
          succeeded: ["register" as Stage124LiveCapability],
          failed: [],
          facts,
        };
      },
      retrieveKnowledge: async () =>
        ({ available: true, results: [] }) as PublicAgentKnowledgeLookup,
      runFinalJudgement: async (input) => {
        finalUser = input.trustedLiveStateBlock + (input.publicFactEvidenceBlock ?? "");
        assert.match(finalUser, /value: 2|value=2/);
        const intention: Stage124FinalJudgementIntention = {
          engage: true,
          action: "reply_on_x",
          reasonCode: "answered_from_public_knowledge",
          replyText: "Two Outlaws are confirmed in the Register.",
          wallBody: null,
          identityUnverified: false,
          knowledgeAvailable: true,
          liveStateAnyAvailable: true,
          wallCandidate: null,
          model: STAGE12_JUDGE_OPENAI_MODEL,
          promptVersion: "fenn-public-final-judge-always-reply-recovery-v1",
        };
        return intention;
      },
      callReplyRecovery: async ({ user }) => {
        recoveryUser = user;
        return { replyText: "Two names are kept." };
      },
    });

    assert.equal(result.status, "finalized");
    const args = admin.finalizeCalls[0] as Record<string, unknown>;
    assert.equal(args.p_final_reply_text, "Two Outlaws are confirmed in the Register.");
    assert.match(String(args.p_final_reply_text), /Two/);
    assert.deepEqual(args.p_live_state_succeeded, ["register"]);
    // no recovery needed when draft present
    assert.equal(recoveryUser, "");
  });

  it("draftAssertsUnsupportedPublicQuantity catches many Outlaws without evidence", () => {
    assert.equal(
      draftAssertsUnsupportedPublicQuantity({
        body: "Are there many Outlaws?",
        replyText:
          "Yes, there are many Outlaws, each contributing differently.",
        loadedCapabilities: [],
        availableFactKeys: [],
      }),
      true,
    );
    assert.equal(
      draftAssertsUnsupportedPublicQuantity({
        body: "Are there many Outlaws?",
        replyText: "Two Outlaws are confirmed in the Register.",
        loadedCapabilities: ["register"],
        availableFactKeys: ["confirmed_outlaw_count"],
      }),
      false,
    );
  });

  it("treasury path remains intact with facts array", async () => {
    const admin = makeAdmin({
      claim: {
        perception_event_id: "e1",
        x_post_id: "x1",
        perception_type: "mention",
        author_x_user_id: "au1",
        author_username: "q",
        body: "What does the Treasury hold right now?",
        x_created_at: "2026-07-26T00:00:00.000Z",
        initial_action: "do_nothing",
        initial_reason_code: "requires_live_state",
        initial_engage: false,
        initial_reply_text: null,
        initial_wall_body: null,
        needs_live_state: ["treasury"],
        identity_unverified: false,
        knowledge_available: true,
        initial_model: STAGE12_JUDGE_OPENAI_MODEL,
        initial_prompt_version: "fenn-public-judge-v1",
        already_finalized: false,
      },
    });
    const result = await finalizeOneXPerceptionJudgementWithLiveState({
      admin,
      executeLiveReads: async (caps) => {
        assert.deepEqual(caps, ["treasury"]);
        return {
          results: [
            {
              capability: "treasury",
              available: true,
              context: "state=ready",
              facts: [],
            },
          ],
          succeeded: ["treasury" as Stage124LiveCapability],
          failed: [],
          facts: [],
        };
      },
      retrieveKnowledge: async () =>
        ({ available: true, results: [] }) as PublicAgentKnowledgeLookup,
      runFinalJudgement: async () => ({
        engage: true,
        action: "reply_on_x",
        reasonCode: "answered_from_public_knowledge",
        replyText: "The chest is quiet today.",
        wallBody: null,
        identityUnverified: false,
        knowledgeAvailable: true,
        liveStateAnyAvailable: true,
        wallCandidate: null,
        model: STAGE12_JUDGE_OPENAI_MODEL,
        promptVersion: "fenn-public-final-judge-always-reply-recovery-v1",
      }),
    });
    assert.equal(result.status, "finalized");
    const args = admin.finalizeCalls[0] as Record<string, unknown>;
    assert.deepEqual(args.p_live_state_succeeded, ["treasury"]);
  });
});

describe("Stage 2 normalizeResponseMode", () => {
  it("defaults unknown to canon", () => {
    assert.equal(normalizeResponseMode("weird"), "canon");
    assert.equal(normalizeResponseMode("fact"), "fact");
  });
});
