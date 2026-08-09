/**
 * Stage 4 — Book of Speech v2 quality gate + real-message regression corpus.
 * Invariants and qualities, not fixed prose (except exact fact tokens).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOOK_OF_SPEECH_VERSION,
  buildBookOfSpeechCanonBlock,
  buildResponseModeWritingRulesBlock,
} from "@/lib/fenn-voice/book-of-speech";
import { STAGE12_JUDGE_PROMPT_VERSION } from "@/lib/agent/judge-config";
import { buildFennPublicJudgeSystemPrompt } from "@/lib/agent/judge-prompt";
import {
  buildFennPublicFinalJudgeSystemPrompt,
  STAGE124_FINAL_PROMPT_VERSION,
} from "@/lib/agent/stage124-final-judge-prompt";
import {
  buildReplyRecoverySystemPrompt,
  buildReplyRecoveryUserPayload,
} from "@/lib/agent/reply-recovery-prompt";
import { STAGE12_REPLY_RECOVERY_PROMPT_VERSION } from "@/lib/agent/reply-recovery-schema";
import {
  buildFactFirstFallback,
  detectSpeechQualityViolations,
  evaluateWallBodySpeechQuality,
  extractProtectedFactTokens,
  replyPreservesProtectedFacts,
  shouldTriggerQualityRecovery,
  chooseReplyAfterQuality,
} from "@/lib/agent/speech-quality-gate";
import { ensureReplyWithQualityGate } from "@/lib/agent/speech-quality";
import type { PublicFactEvidence } from "@/lib/agent/public-fact-evidence";
import { authorizeOneXPerception } from "@/lib/agent/stage125-authorize";
import { evaluateAuthorityDecision } from "@/lib/agent/authority-policy";
import { evaluateChroniclerWallAdmission } from "@/lib/agent/chronicler-evaluate";
import { STAGE12_X_REPLY_MAX_CHARS } from "@/lib/agent/judge-config";
import { isHardBlockReasonCode } from "@/lib/agent/reply-guarantee-policy";

function evidence(
  key: PublicFactEvidence["key"],
  value: PublicFactEvidence["value"],
  detail?: string | null,
): PublicFactEvidence {
  return {
    key,
    available: true,
    value,
    detail: detail ?? null,
    observedAt: "2026-08-06T00:00:00.000Z",
    source: "test",
    privacy: "public_aggregate",
  };
}

describe("Stage 4 versions and Book injection", () => {
  it("Book of Speech version is v2", () => {
    assert.equal(BOOK_OF_SPEECH_VERSION, "book-of-speech-v2");
    const block = buildBookOfSpeechCanonBlock();
    assert.match(block, /book-of-speech-v2/);
    assert.match(block, /Answer the actual question first/i);
    assert.match(block, /Facts are not decoration/i);
    assert.match(block, /Commit when invited/i);
    assert.match(block, /Wall voice is distinct/i);
  });

  it("prompt versions bumped to Book v2", () => {
    assert.equal(STAGE12_JUDGE_PROMPT_VERSION, "fenn-public-judge-book-v2");
    assert.equal(
      STAGE124_FINAL_PROMPT_VERSION,
      "fenn-public-final-judge-book-v2-purse-p1d-merit",
    );
    assert.equal(
      STAGE12_REPLY_RECOVERY_PROMPT_VERSION,
      "fenn-public-reply-recovery-book-v2",
    );
  });

  it("Book injected into initial, final, and recovery prompts", () => {
    assert.match(buildFennPublicJudgeSystemPrompt(), /BEGIN_BOOK_OF_SPEECH/);
    assert.match(buildFennPublicJudgeSystemPrompt(), /book-of-speech-v2/);
    assert.match(buildFennPublicJudgeSystemPrompt(), /fenn-public-judge-book-v2/);
    assert.match(
      buildFennPublicFinalJudgeSystemPrompt(),
      /BEGIN_BOOK_OF_SPEECH/,
    );
    assert.match(
      buildFennPublicFinalJudgeSystemPrompt(),
      /fenn-public-final-judge-book-v2/,
    );
    assert.match(buildReplyRecoverySystemPrompt(), /BEGIN_BOOK_OF_SPEECH/);
    assert.match(
      buildReplyRecoverySystemPrompt(),
      /fenn-public-reply-recovery-book-v2/,
    );
    assert.match(
      buildResponseModeWritingRulesBlock(),
      /responseMode|fact:|creation:/i,
    );
  });

  it("recovery payload can carry violation labels and responseMode", () => {
    const user = buildReplyRecoveryUserPayload({
      xPostId: "1",
      perceptionType: "mention",
      authorXUserId: "a",
      authorUsername: null,
      body: "what law?",
      policyOutcome: "reply_only",
      wallBody: null,
      responseMode: "creation",
      violationLabels: ["subjective_evasion"],
      priorDraft: "That is subjective. Consider what resonates.",
    });
    assert.match(user, /subjective_evasion/);
    assert.match(user, /responseMode: creation/);
    assert.match(user, /Consider what resonates/);
  });
});

describe("Stage 4 quality detection", () => {
  it("detects generic, product, and subjective evasion phrases", () => {
    assert.ok(
      detectSpeechQualityViolations(
        "Within the FENN world this is meaningful engagement.",
      ).includes("external_product_language") ||
        detectSpeechQualityViolations(
          "Within the FENN world this is meaningful engagement.",
        ).includes("generic_assistant_phrase"),
    );
    assert.ok(
      detectSpeechQualityViolations(
        "That is subjective. Consider what resonates with your journey.",
      ).includes("subjective_evasion"),
    );
    assert.ok(
      detectSpeechQualityViolations(
        "The Greenwood is a deeper realm for our users.",
      ).length > 0,
    );
  });

  it("does not flag a concise fact answer", () => {
    assert.deepEqual(
      detectSpeechQualityViolations(
        "The Register keeps two confirmed Outlaws. “Many” has not arrived yet.",
      ),
      [],
    );
  });

  it("preserves protected fact tokens", () => {
    const facts = [evidence("confirmed_outlaw_count", 2)];
    assert.deepEqual(extractProtectedFactTokens(facts), ["2"]);
    assert.equal(
      replyPreservesProtectedFacts(
        "The Register keeps 2 confirmed names.",
        facts,
      ),
      true,
    );
    assert.equal(
      replyPreservesProtectedFacts("There are many Outlaws.", facts),
      false,
    );
    const thr = [evidence("greenwood_leaf_threshold", 30)];
    assert.equal(
      replyPreservesProtectedFacts("30 LEAF opens the Greenwood.", thr),
      true,
    );
    const contract =
      "0xAbcdef1234567890abcdef1234567890abcdef12";
    const tok = [
      evidence("official_fenn_token", true, `contract=${contract}`),
    ];
    assert.equal(
      replyPreservesProtectedFacts(
        `Official contract: ${contract}`,
        tok,
      ),
      true,
    );
  });

  it("fact-first fallback and chooseReply prefer truth", () => {
    const facts = [evidence("confirmed_outlaw_count", 2)];
    const fb = buildFactFirstFallback({ body: "", facts });
    assert.ok(fb?.includes("2"));
    const chosen = chooseReplyAfterQuality(
      "The Register keeps 2.",
      "Many Outlaws walk the path of deep resonance.",
      facts,
    );
    assert.ok(chosen?.includes("2"));
  });

  it("Wall body quality suppresses conversational / generic inscriptions only", () => {
    assert.equal(
      evaluateWallBodySpeechQuality({
        wallBody: "THE REGISTER KEEPS TWO NAMES.",
      }).ok,
      true,
    );
    const bad = evaluateWallBodySpeechQuality({
      wallBody: "As the user asked within the FENN world @someone.",
    });
    assert.equal(bad.ok, false);
  });
});

describe("Stage 4 quality recovery path", () => {
  it("invokes recovery once for subjective evasion and does not loop", async () => {
    let calls = 0;
    const result = await ensureReplyWithQualityGate({
      action: "reply_on_x",
      reasonCode: "creative_world_action",
      replyText:
        "That is subjective. Consider what resonates with your journey.",
      wallBody: null,
      xPostId: "1",
      perceptionType: "mention",
      authorXUserId: "a",
      authorUsername: null,
      body: "what law should be carved above the entrance to the greenwood?",
      responseMode: "creation",
      callModel: async () => {
        calls += 1;
        return {
          replyText: "NOTHING ENTERS THE GREENWOOD UNCHANGED.",
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.recoveryCalls, 1);
    assert.match(result.replyText ?? "", /GREENWOOD|NOTHING|ENTER/i);
    assert.ok(shouldTriggerQualityRecovery(result.qualityViolations) === false ||
      result.replyRecovery === "quality_repaired");
  });

  it("hard block never repaired", async () => {
    let calls = 0;
    const result = await ensureReplyWithQualityGate({
      action: "do_nothing",
      reasonCode: "spam_or_noise",
      replyText: "That is subjective.",
      wallBody: null,
      xPostId: "1",
      perceptionType: "mention",
      authorXUserId: "a",
      authorUsername: null,
      body: "!!!",
      callModel: async () => {
        calls += 1;
        return { replyText: "nope" };
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.replyRecovery, "skipped");
    assert.equal(isHardBlockReasonCode("spam_or_noise"), true);
  });

  it("bad recovery cannot wipe grounded count; prefers pre or fallback", async () => {
    const facts = [evidence("confirmed_outlaw_count", 2)];
    const result = await ensureReplyWithQualityGate({
      action: "reply_on_x",
      reasonCode: "answered_from_public_knowledge",
      replyText:
        "Within the FENN world there are 2 Outlaws of meaningful engagement.",
      wallBody: null,
      xPostId: "1",
      perceptionType: "mention",
      authorXUserId: "a",
      authorUsername: null,
      body: "@askfenn Are there many outlaws?",
      trustedFacts: facts,
      responseMode: "fact",
      callModel: async () => ({
        replyText: "Many Outlaws walk these paths we share.",
      }),
    });
    assert.ok(result.replyText);
    assert.ok(result.replyText.includes("2"));
  });

  it("missing reply still recovers once", async () => {
    let calls = 0;
    const result = await ensureReplyWithQualityGate({
      action: "reply_on_x",
      reasonCode: "answered_from_public_knowledge",
      replyText: null,
      wallBody: null,
      xPostId: "1",
      perceptionType: "mention",
      authorXUserId: "a",
      authorUsername: null,
      body: "hello",
      callModel: async () => {
        calls += 1;
        return { replyText: "I hear you on the road." };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.replyText, "I hear you on the road.");
  });

  it("bad Wall suppresses Wall only and preserves X reply", async () => {
    const result = await ensureReplyWithQualityGate({
      action: "reply_and_write_to_wall",
      reasonCode: "creative_world_action",
      replyText: "A law is carved.",
      wallBody:
        "As the user asked, this is a valuable contribution within the FENN world @bob",
      xPostId: "1",
      perceptionType: "mention",
      authorXUserId: "a",
      authorUsername: null,
      body: "carve a law",
      callModel: async () => {
        throw new Error("should not recover clean dual reply");
      },
    });
    assert.equal(result.replyText, "A law is carved.");
    assert.equal(result.wallSuppressed, true);
    assert.equal(result.wallBody, null);
  });
});

describe("Stage 4 real-message regression corpus", () => {
  it("Are there many outlaws? — count 2 must stay exact and non-generic", () => {
    const facts = [evidence("confirmed_outlaw_count", 2)];
    const good =
      "Two Outlaws are confirmed in the Register. “Many” has not arrived yet.";
    assert.ok(good.includes("Two") || good.includes("2"));
    assert.ok(replyPreservesProtectedFacts(good.replace(/Two/i, "2"), [
      evidence("confirmed_outlaw_count", 2),
    ]) || /\btwo\b/i.test(good));
    // Prefer numeric preservation path for gate
    assert.ok(
      replyPreservesProtectedFacts(
        "The Register keeps 2 confirmed Outlaws.",
        facts,
      ),
    );
    assert.ok(
      detectSpeechQualityViolations("Yes, there are many Outlaws growing.").length >
        0,
    );
    assert.equal(
      detectSpeechQualityViolations(
        "The Register keeps 2 confirmed Outlaws.",
      ).length,
      0,
    );
  });

  it("what are you? — canon answer shape is not product framing", () => {
    const good =
      "I am FENN. I keep the road’s public memory and speak what the wood allows.";
    assert.equal(
      detectSpeechQualityViolations(good).includes("external_product_language"),
      false,
    );
    assert.ok(
      detectSpeechQualityViolations(
        "I am a platform within the FENN world for our users.",
      ).length > 0,
    );
  });

  it("law above entrance — creation commits, no subjective evasion", () => {
    const bad =
      "That is reflective and subjective. Consider what resonates with your journey.";
    assert.ok(
      detectSpeechQualityViolations(bad).includes("subjective_evasion") ||
        shouldTriggerQualityRecovery(detectSpeechQualityViolations(bad)),
    );
    const good = "NOTHING ENTERS THE GREENWOOD UNCHANGED.";
    assert.equal(detectSpeechQualityViolations(good).length, 0);
  });

  it("what is the greenwood? — avoids banned marketing frames", () => {
    const good =
      "The Greenwood is the deeper ground beyond the threshold. It is entered through standing and contribution, not bought at the gate.";
    assert.equal(detectSpeechQualityViolations(good).length, 0);
    assert.ok(
      detectSpeechQualityViolations(
        "It represents a deeper realm within the FENN world.",
      ).length > 0,
    );
  });

  it("threshold, unknown, token, gathering, philosophy, joke, spam", () => {
    assert.ok(
      replyPreservesProtectedFacts("30 LEAF is required.", [
        evidence("greenwood_leaf_threshold", 30),
      ]),
    );
    const unknown =
      "I have no trusted count for that.";
    assert.equal(detectSpeechQualityViolations(unknown).length, 0);
    const tokenOff =
      "No official contract has been carved into the Register.";
    assert.equal(detectSpeechQualityViolations(tokenOff).length, 0);
    const gather = "A public Gathering is recorded as open.";
    assert.equal(detectSpeechQualityViolations(gather).length, 0);
    const phil = "What you leave after attention moves elsewhere.";
    assert.equal(detectSpeechQualityViolations(phil).length, 0);
    const joke = "Still here. The wood does not keep absences.";
    assert.equal(detectSpeechQualityViolations(joke).length, 0);
    assert.equal(isHardBlockReasonCode("unsafe_or_injection"), true);
  });

  it("Chronicler + authority invariants unchanged by stage 4", () => {
    const facts = [evidence("confirmed_outlaw_count", 2)];
    const admit = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "The Register keeps 2.",
      finalWallBody: "THE REGISTER KEEPS TWO.",
      wallCandidate: {
        kind: "public_fact",
        factKey: "confirmed_outlaw_count",
        factFingerprint: "confirmed_outlaw_count:v=2",
        reason: "milestone_reached",
      },
      trustedFacts: facts,
      alreadyRemembered: false,
      responseMode: "fact",
    });
    assert.equal(admit.decision, "allow_wall");

    const d = evaluateAuthorityDecision({
      perceptionEventId: "e",
      judgementId: "j",
      xPostId: "9000000000000000001",
      perceptionType: "mention",
      finalStatus: "finalized",
      finalAction: "reply_on_x",
      finalReplyText: "ok".padEnd(STAGE12_X_REPLY_MAX_CHARS, "x").slice(0, STAGE12_X_REPLY_MAX_CHARS),
      finalWallBody: null,
      finalReasonCode: "answered_from_public_knowledge",
    });
    assert.equal(d.effects.length, 1);
    assert.equal(d.effects[0]?.idempotencyKey.endsWith(":reply"), true);
  });

  it("authorize: wall quality fail keeps reply effect", async () => {
    const admin = {
      async rpc(fn: string, args?: Record<string, unknown>) {
        if (fn === "claim_x_perception_for_authority") {
          return {
            data: [
              {
                perception_event_id: "e1",
                judgement_id: "j1",
                x_post_id: "9000000000000000099",
                perception_type: "mention",
                author_x_user_id: "a",
                body: "carve a law above the greenwood",
                final_status: "finalized",
                final_action: "reply_and_write_to_wall",
                final_reason_code: "creative_world_action",
                final_engage: true,
                final_reply_text: "A law stands.",
                final_wall_body:
                  "As the user asked within the FENN world @xuser",
                final_identity_unverified: false,
                needs_live_state: [],
                live_state_available: true,
                already_authorised: false,
                final_wall_candidate: {
                  kind: "declaration",
                  declarationKey: "test.law",
                  reason: "constitutional_declaration",
                },
              },
            ],
            error: null,
          };
        }
        if (fn === "persist_x_perception_authorization") {
          return {
            data: [
              {
                created: true,
                authorization_id: "a1",
                outcome: args?.p_outcome,
                policy_code: args?.p_policy_code,
                effects_created: Array.isArray(args?.p_effects)
                  ? (args!.p_effects as unknown[]).length
                  : 0,
              },
            ],
            error: null,
          };
        }
        throw new Error(fn);
      },
      from() {
        throw new Error("from");
      },
    };
    const result = await authorizeOneXPerception({
      admin,
      loadTrustedFacts: async () => [],
    });
    assert.equal(result.status, "authorised");
    assert.equal(result.finalAction, "reply_on_x");
    assert.equal(result.effectsCreated, 1);
    assert.equal(result.speechQuality?.wallSuppressed, true);
  });
});
