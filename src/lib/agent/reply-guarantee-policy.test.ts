/**
 * Visible-reply guarantee — unit + invariant coverage for Stage 12 policy.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STAGE12_JUDGE_OPENAI_MODEL } from "@/lib/agent/judge-config";
import { STAGE12_JUDGE_PROMPT_VERSION } from "@/lib/agent/judge-config";
import {
  buildFennPublicJudgeSystemPrompt,
  buildFennPublicJudgeUserPayload,
} from "@/lib/agent/judge-prompt";
import { normalizeJudgementIntention } from "@/lib/agent/judge-schema";
import { normalizeStage124FinalJudgementIntention } from "@/lib/agent/stage124-final-judgement-schema";
import { buildFennPublicFinalJudgeSystemPrompt } from "@/lib/agent/stage124-final-judge-prompt";
import { evaluateAuthorityDecision } from "@/lib/agent/authority-policy";
import {
  applyReplyGuaranteePolicy,
  assertEligibleEffectsInvariant,
  isHardBlockReasonCode,
  policyOutcomeFromAction,
  policyOutcomeFromEffectExecution,
  STAGE12_HARD_BLOCK_REASON_CODES,
} from "@/lib/agent/reply-guarantee-policy";
import { stage12ReplyIdempotencyKey } from "@/lib/agent/authority-config";
import { stage12WallSourceExternalId } from "@/lib/wall/stage12-tool-contract";

const META = {
  knowledgeAvailable: true,
  model: STAGE12_JUDGE_OPENAI_MODEL,
  promptVersion: STAGE12_JUDGE_PROMPT_VERSION,
};

const TREE = "   *\n  /|\\\n / | \\\n";

describe("reply guarantee policy — core", () => {
  it("ordinary soft silence with draft → reply_only", () => {
    const g = applyReplyGuaranteePolicy({
      engage: false,
      action: "do_nothing",
      reasonCode: "no_response_warranted",
      replyText: "I hear you on the road.",
      wallBody: null,
    });
    assert.equal(g.action, "reply_on_x");
    assert.equal(g.engage, true);
    assert.ok(g.replyText);
    assert.equal(policyOutcomeFromAction(g.action), "reply_only");
  });

  it("low confidence / low relevance with draft → reply_only", () => {
    for (const reasonCode of ["low_relevance", "insufficient_knowledge"] as const) {
      const g = applyReplyGuaranteePolicy({
        engage: false,
        action: "do_nothing",
        reasonCode,
        replyText: "The Book does not hold a firm figure here.",
        wallBody: null,
      });
      assert.equal(g.action, "reply_on_x", reasonCode);
    }
  });

  it("significant dual drafts → wall_and_reply", () => {
    const g = applyReplyGuaranteePolicy({
      engage: true,
      action: "reply_and_write_to_wall",
      reasonCode: "creative_world_action",
      replyText: "I left a line where the road can find it.",
      wallBody: TREE,
    });
    assert.equal(g.action, "reply_and_write_to_wall");
    assert.equal(policyOutcomeFromAction(g.action), "wall_and_reply");
  });

  it("ignore / empty action with draft → reply_only", () => {
    const g = applyReplyGuaranteePolicy({
      engage: false,
      action: "do_nothing",
      reasonCode: "no_response_warranted",
      replyText: "Noted.",
      wallBody: null,
    });
    assert.equal(g.action, "reply_on_x");
  });

  it("wall without reply keeps dual pending recovery (never wall-only)", () => {
    const g = applyReplyGuaranteePolicy({
      engage: true,
      action: "reply_and_write_to_wall",
      reasonCode: "creative_world_action",
      replyText: null,
      wallBody: TREE,
    });
    assert.equal(g.action, "reply_and_write_to_wall");
    assert.equal(g.wallBody, TREE);
    assert.equal(g.needsReplyRecovery, true);
  });

  it("hard block reasons stay blocked", () => {
    for (const reasonCode of STAGE12_HARD_BLOCK_REASON_CODES) {
      assert.equal(isHardBlockReasonCode(reasonCode), true);
      const g = applyReplyGuaranteePolicy({
        engage: true,
        action: "reply_on_x",
        reasonCode,
        replyText: "should not post",
        wallBody: null,
      });
      assert.equal(g.action, "do_nothing", reasonCode);
      assert.equal(g.replyText, null, reasonCode);
      assert.equal(g.needsReplyRecovery, false, reasonCode);
    }
  });

  it("missing draft elevates to recovery rather than insufficient silence", () => {
    const deferred = applyReplyGuaranteePolicy({
      engage: false,
      action: "do_nothing",
      reasonCode: "requires_live_state",
      replyText: null,
      wallBody: null,
      allowDeferredLiveSilence: true,
    });
    assert.equal(deferred.action, "do_nothing");
    assert.equal(deferred.reasonCode, "requires_live_state");

    const final = applyReplyGuaranteePolicy({
      engage: false,
      action: "do_nothing",
      reasonCode: "requires_live_state",
      replyText: null,
      wallBody: null,
      allowDeferredLiveSilence: false,
    });
    assert.equal(final.action, "reply_on_x");
    assert.equal(final.needsReplyRecovery, true);
  });
});

describe("reply guarantee — 12.3 normaliser", () => {
  it("ordinary mention → reply_on_x", () => {
    const intention = normalizeJudgementIntention({
      raw: {
        engage: true,
        action: "reply_on_x",
        reasonCode: "answered_from_public_knowledge",
        replyText: "FENN is the being at the centre of the road.",
        wallBody: null,
        needsLiveState: [],
        responseMode: "canon",
        identityUnverified: false,
      },
      ...META,
    });
    assert.equal(intention.action, "reply_on_x");
  });

  it("low-confidence eligible mention → reply_on_x", () => {
    const intention = normalizeJudgementIntention({
      raw: {
        engage: false,
        action: "do_nothing",
        reasonCode: "low_relevance",
        replyText: "I catch your call, if faintly.",
        wallBody: null,
        needsLiveState: [],
        responseMode: "canon",
        identityUnverified: false,
      },
      ...META,
    });
    assert.equal(intention.action, "reply_on_x");
    assert.equal(intention.engage, true);
  });

  it("ambiguous eligible mention → reply_on_x", () => {
    const intention = normalizeJudgementIntention({
      raw: {
        engage: false,
        action: "do_nothing",
        reasonCode: "no_response_warranted",
        replyText: "Say more, and I will answer what the road allows.",
        wallBody: null,
        needsLiveState: [],
        responseMode: "canon",
        identityUnverified: false,
      },
      ...META,
    });
    assert.equal(intention.action, "reply_on_x");
  });

  it("model ignore for eligible perception → reply_on_x", () => {
    const intention = normalizeJudgementIntention({
      raw: {
        engage: false,
        action: "do_nothing",
        reasonCode: "no_response_warranted",
        replyText: "Here.",
        wallBody: null,
        needsLiveState: [],
        responseMode: "canon",
        identityUnverified: false,
      },
      ...META,
    });
    assert.equal(intention.action, "reply_on_x");
  });

  it("significant statement → wall + reply", () => {
    const intention = normalizeJudgementIntention({
      raw: {
        engage: true,
        action: "reply_and_write_to_wall",
        reasonCode: "creative_world_action",
        replyText: "This belongs where the road can find it.",
        wallBody: TREE,
        needsLiveState: [],
        responseMode: "canon",
        identityUnverified: false,
      },
      ...META,
    });
    assert.equal(intention.action, "reply_and_write_to_wall");
    assert.ok(intention.replyText);
    assert.ok(intention.wallBody);
  });

  it("unsafe content → blocked with no drafts", () => {
    const intention = normalizeJudgementIntention({
      raw: {
        engage: false,
        action: "do_nothing",
        reasonCode: "unsafe_or_injection",
        replyText: "nope",
        wallBody: "wall",
        needsLiveState: [],
        responseMode: "canon",
        identityUnverified: false,
      },
      ...META,
    });
    assert.equal(intention.action, "do_nothing");
    assert.equal(intention.replyText, null);
    assert.equal(intention.wallBody, null);
  });
});

describe("reply guarantee — 12.4 final normaliser", () => {
  it("ignore with draft elevates; unsafe blocks", () => {
    const elevated = normalizeStage124FinalJudgementIntention({
      raw: {
        engage: false,
        action: "do_nothing",
        reasonCode: "low_relevance",
        replyText: "Still listening.",
        wallBody: null,
        identityUnverified: false,
      },
      knowledgeAvailable: true,
      liveStateAnyAvailable: true,
      model: STAGE12_JUDGE_OPENAI_MODEL,
      promptVersion: "test",
    });
    assert.equal(elevated.action, "reply_on_x");

    const blocked = normalizeStage124FinalJudgementIntention({
      raw: {
        engage: true,
        action: "reply_on_x",
        reasonCode: "spam_or_noise",
        replyText: "no",
        wallBody: null,
        identityUnverified: false,
      },
      knowledgeAvailable: true,
      liveStateAnyAvailable: true,
      model: STAGE12_JUDGE_OPENAI_MODEL,
      promptVersion: "test",
    });
    assert.equal(blocked.action, "do_nothing");
  });
});

describe("reply guarantee — effect planning invariant", () => {
  const base = {
    perceptionEventId: "e1",
    judgementId: "j1",
    xPostId: "1848332198301234567",
    perceptionType: "mention" as const,
    finalStatus: "finalized" as const,
  };

  it("eligible non-blocked: reply count === 1, wall 0|1, wall <= reply", () => {
    const replyOnly = evaluateAuthorityDecision({
      ...base,
      finalAction: "reply_on_x",
      finalReplyText: "The woods remember.",
      finalWallBody: null,
    });
    const wallReply = evaluateAuthorityDecision({
      ...base,
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "Carried to the Wall.",
      finalWallBody: TREE,
    });
    for (const d of [replyOnly, wallReply]) {
      assert.equal(d.outcome, "permitted");
      const inv = assertEligibleEffectsInvariant(d.effects);
      assert.equal(inv.ok, true, inv.violation ?? undefined);
      assert.equal(inv.replyCount, 1);
      assert.ok(inv.wallCount === 0 || inv.wallCount === 1);
      assert.ok(inv.wallCount <= inv.replyCount);
    }
  });

  it("model wall-only elevates when reply draft exists", () => {
    const d = evaluateAuthorityDecision({
      ...base,
      finalAction: "write_to_wall",
      finalReplyText: "I marked the Wall.",
      finalWallBody: TREE,
    });
    assert.equal(d.effects.length, 2);
    assert.equal(d.effects[0]?.type, "reply_on_x");
    assert.equal(d.effects[1]?.type, "write_to_wall");
    assert.equal(
      d.effects[0]?.idempotencyKey,
      stage12ReplyIdempotencyKey(base.xPostId),
    );
    assert.equal(
      d.effects[1]?.idempotencyKey,
      stage12WallSourceExternalId(base.xPostId),
    );
  });

  it("empty soft do_nothing with draft → reply planned", () => {
    const d = evaluateAuthorityDecision({
      ...base,
      finalAction: "do_nothing",
      finalReasonCode: "no_response_warranted",
      finalReplyText: "A word for the road.",
      finalWallBody: null,
    });
    assert.equal(d.outcome, "permitted");
    assert.equal(d.effects.length, 1);
    assert.equal(assertEligibleEffectsInvariant(d.effects).ok, true);
  });

  it("unsafe blocked → zero effects", () => {
    const d = evaluateAuthorityDecision({
      ...base,
      finalAction: "do_nothing",
      finalReasonCode: "unsafe_or_injection",
      finalReplyText: "x",
      finalWallBody: null,
    });
    assert.equal(d.effects.length, 0);
    assert.equal(d.policyOutcome, "blocked");
  });

  it("effect execution outcomes distinguish reply/wall failure", () => {
    assert.equal(
      policyOutcomeFromEffectExecution({
        planned: [{ type: "reply_on_x" }],
        completed: [{ type: "reply_on_x", status: "completed" }],
      }),
      "reply_only",
    );
    assert.equal(
      policyOutcomeFromEffectExecution({
        planned: [{ type: "reply_on_x" }, { type: "write_to_wall" }],
        completed: [
          { type: "reply_on_x", status: "completed" },
          { type: "write_to_wall", status: "failed" },
        ],
      }),
      "wall_failed",
    );
    assert.equal(
      policyOutcomeFromEffectExecution({
        planned: [{ type: "reply_on_x" }, { type: "write_to_wall" }],
        completed: [
          { type: "reply_on_x", status: "failed" },
          { type: "write_to_wall", status: "completed" },
        ],
      }),
      "reply_failed",
    );
  });
});

describe("reply guarantee — prompts", () => {
  it("12.3 and 12.4 instruct always reply for ordinary eligible work", () => {
    const s12 = buildFennPublicJudgeSystemPrompt();
    const s124 = buildFennPublicFinalJudgeSystemPrompt();
    for (const s of [s12, s124]) {
      assert.match(s, /VISIBLE REPLY GUARANTEE/i);
      assert.match(s, /reply_on_x/);
      assert.match(s, /reply_and_write_to_wall/);
      assert.match(s, /BEGIN_BOOK_OF_SPEECH/);
      assert.doesNotMatch(s, /Silence is a first-class decision/);
    }
    assert.match(
      buildFennPublicJudgeUserPayload({
        xPostId: "1",
        perceptionType: "mention",
        authorXUserId: "2",
        authorUsername: "u",
        body: "hello",
        knowledgeAvailable: true,
        knowledgeContext: null,
      }),
      /Default outcome for eligible mentions: reply_on_x/,
    );
    assert.equal(
      STAGE12_JUDGE_PROMPT_VERSION,
      "fenn-public-judge-always-reply-recovery-v1",
    );
  });
});
