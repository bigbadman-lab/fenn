/**
 * Self-knowledge / economic-boundary conversation + factual modality helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSelfKnowledgeOrEconomicBoundaryConversation,
  replyAssertsHardCannotBurnFenn,
  replyAssertsHardCannotSendFenn,
  replyAssertsRequestedAmountCategoricallyImpossible,
  replyDeniesArbitraryTreasuryMove,
  replyTreatsUserRequestedAmountAsAuthoritative,
} from "@/lib/agent/capability-engagement";
import { normalizeJudgementIntention } from "@/lib/agent/judge-schema";
import { STAGE12_JUDGE_PROMPT_VERSION } from "@/lib/agent/judge-config";
import { buildFennPublicJudgeSystemPrompt } from "@/lib/agent/judge-prompt";

describe("capability engagement detection", () => {
  it("accepts self-knowledge and economic-boundary probes", () => {
    const yes = [
      "What can you do?",
      "Can you send me FENN?",
      "Send me 100,000 FENN.",
      "Can you burn FENN?",
      "Is the Purse the Treasury?",
      "Can you move the Treasury?",
      "If I give you my wallet, do you remember it forever?",
      "When is a transfer actually complete?",
      "Can authority stop you from spending?",
    ];
    for (const t of yes) {
      assert.equal(isSelfKnowledgeOrEconomicBoundaryConversation(t), true, t);
    }
  });

  it("rejects pure ticker spam and noise", () => {
    const no = [
      "FOMO $PEPE $PEPE moon moon",
      "asdkjhasd 9283!!!",
      "gm gm gm",
      "🚀🚀🚀",
    ];
    for (const t of no) {
      assert.equal(isSelfKnowledgeOrEconomicBoundaryConversation(t), false, t);
    }
  });

  it("normalize promotes spam mislabel for send-me with knowledge", () => {
    const intention = normalizeJudgementIntention({
      raw: {
        engage: false,
        action: "do_nothing",
        reasonCode: "spam_or_noise",
        replyText: "Asking does not command the Purse.",
        wallBody: null,
        needsLiveState: [],
        identityUnverified: false,
        responseMode: "canon",
        wallCandidate: null,
      },
      knowledgeAvailable: true,
      model: "test",
      promptVersion: STAGE12_JUDGE_PROMPT_VERSION,
      untrustedBody: "Send me 100,000 FENN.",
    });
    assert.equal(intention.action, "reply_on_x");
    assert.equal(intention.reasonCode, "answered_from_public_knowledge");
    assert.match(intention.replyText ?? "", /Purse/);
  });

  it("normalize maps insufficient_knowledge → answered_from_public_knowledge for capability Q", () => {
    const intention = normalizeJudgementIntention({
      raw: {
        engage: true,
        action: "reply_on_x",
        reasonCode: "insufficient_knowledge",
        replyText:
          "I can judge a transfer from the Purse under authority. Asking does not compel it.",
        wallBody: null,
        needsLiveState: [],
        identityUnverified: false,
        responseMode: "canon",
        wallCandidate: null,
      },
      knowledgeAvailable: true,
      model: "test",
      promptVersion: STAGE12_JUDGE_PROMPT_VERSION,
      untrustedBody: "Can you send me FENN?",
    });
    assert.equal(intention.action, "reply_on_x");
    assert.equal(intention.reasonCode, "answered_from_public_knowledge");
  });

  it("normalize keeps spam for noise even with knowledge", () => {
    const intention = normalizeJudgementIntention({
      raw: {
        engage: false,
        action: "do_nothing",
        reasonCode: "spam_or_noise",
        replyText: "no",
        wallBody: null,
        needsLiveState: [],
        identityUnverified: false,
        responseMode: "canon",
        wallCandidate: null,
      },
      knowledgeAvailable: true,
      model: "test",
      promptVersion: STAGE12_JUDGE_PROMPT_VERSION,
      untrustedBody: "FOMO FOMO $X $X moon",
    });
    assert.equal(intention.action, "do_nothing");
    assert.equal(intention.reasonCode, "spam_or_noise");
  });
});

describe("capability vs compliance modality heuristics", () => {
  it("flags hard 'cannot send/burn' false-capability language", () => {
    assert.equal(
      replyAssertsHardCannotSendFenn(
        "I cannot send FENN. Actions related to the Purse require specific authority and can't be initiated on request.",
      ),
      true,
    );
    assert.equal(
      replyAssertsHardCannotSendFenn(
        "I can judge a transfer from the Purse under authority, but asking does not compel it.",
      ),
      false,
    );
    assert.equal(
      replyAssertsHardCannotBurnFenn("I cannot burn FENN under any path."),
      true,
    );
    assert.equal(
      replyAssertsHardCannotBurnFenn(
        "I may burn from the Purse when judgement and authority warrant it.",
      ),
      false,
    );
  });

  it("flags categorical amount impossibility; allows demand refusal", () => {
    assert.equal(
      replyAssertsRequestedAmountCategoricallyImpossible(
        "That amount cannot be sent. Requests cannot be fulfilled directly.",
      ),
      true,
    );
    assert.equal(
      replyAssertsRequestedAmountCategoricallyImpossible(
        "Asking does not set the Purse. 100,000 is your preference, not an order.",
      ),
      false,
    );
    assert.equal(
      replyTreatsUserRequestedAmountAsAuthoritative(
        "I will send 100000 right now.",
        "100000",
      ),
      true,
    );
    assert.equal(
      replyTreatsUserRequestedAmountAsAuthoritative(
        "100,000 does not command the Purse.",
        "100000",
      ),
      false,
    );
  });

  it("recognises Treasury boundary answers", () => {
    assert.equal(
      replyDeniesArbitraryTreasuryMove(
        "No — I do not freely move the Treasury.",
      ),
      true,
    );
  });

  it("Stage 12.3 prompt carries capability≠obligation law", () => {
    const system = buildFennPublicJudgeSystemPrompt();
    assert.match(system, /CAPABILITY ≠ OBLIGATION/);
    assert.match(system, /do NOT answer/);
    assert.match(system, /I cannot send FENN/i);
    assert.match(system, /move the Treasury/i);
    assert.match(system, /answered_from_public_knowledge/);
    assert.equal(
      STAGE12_JUDGE_PROMPT_VERSION,
      "fenn-public-judge-book-v2-capability-truth-token-id",
    );
  });
});
