/**
 * Stage — self-knowledge calibration harness (no live model / no embeddings).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { getFennCanonDocument } from "@/content/canon";
import {
  buildSelfKnowledgeJudgePreview,
  looksLikeAgencyCapabilities,
  looksLikeEconomyCirculation,
  mapRetrievalRows,
  runSelfKnowledgeCalibration,
  SELF_KNOWLEDGE_CALIBRATION_MODE,
} from "@/lib/agent/self-knowledge-calibration";
import { isSelfKnowledgeOrEconomicBoundaryConversation } from "@/lib/agent/capability-engagement";
import { buildPublicAgentKnowledgeContext } from "@/lib/agent/context";
import { assemblePublicAgentContext } from "@/lib/agent/stage12-contract";
import type { RetrievedFennKnowledge } from "@/lib/memory/retrieve";
import type { Stage12JudgementModelOutput } from "@/lib/agent/judge-schema";
import { normalizeJudgementIntention } from "@/lib/agent/judge-schema";
import { BOOK_OF_SPEECH_MARKERS } from "@/lib/fenn-voice/book-of-speech";
import {
  buildFennPublicJudgeSystemPrompt,
} from "@/lib/agent/judge-prompt";
import { STAGE12_JUDGE_PROMPT_VERSION } from "@/lib/agent/judge-config";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function chunk(
  overrides: Partial<RetrievedFennKnowledge> &
    Pick<RetrievedFennKnowledge, "memoryId" | "title" | "text">,
): RetrievedFennKnowledge {
  return {
    memoryId: overrides.memoryId,
    layer: overrides.layer ?? "canon",
    title: overrides.title,
    text: overrides.text,
    chunkIndex: overrides.chunkIndex ?? 0,
    score: overrides.score ?? 0.9,
    visibility: overrides.visibility ?? "public",
  };
}

function okModelOutput(
  replyText: string,
): Stage12JudgementModelOutput {
  return {
    engage: true,
    action: "reply_on_x",
    reasonCode: "answered_from_public_knowledge",
    replyText,
    wallBody: null,
    needsLiveState: [],
    identityUnverified: false,
    responseMode: "canon",
    wallCandidate: null,
  };
}

describe("Self-knowledge calibration harness", () => {
  it("1–3. acceptance queries surface agency/economy sheets when retrieved", async () => {
    const agency = getFennCanonDocument("fenn.agency.capabilities");
    const economy = getFennCanonDocument("fenn.economy.circulation");
    assert.ok(agency);
    assert.ok(economy);

    const agencyHit = chunk({
      memoryId: "canon-agency",
      title: agency.title,
      text: agency.content,
      score: 0.95,
    });
    const econHit = chunk({
      memoryId: "canon-econ",
      title: economy.title,
      text: economy.content,
      score: 0.88,
    });
    assert.equal(looksLikeAgencyCapabilities(agencyHit), true);
    assert.equal(looksLikeEconomyCirculation(econHit), true);

    const byQuery: Record<string, RetrievedFennKnowledge[]> = {
      "What can you do?": [agencyHit],
      "Can you send FENN?": [agencyHit],
      "Is the Purse the Treasury?": [agencyHit, econHit],
    };

    for (const [query, hits] of Object.entries(byQuery)) {
      const result = await runSelfKnowledgeCalibration(
        { text: query },
        {
          retrieve: async () => hits,
          callModel: async () =>
            okModelOutput(`mock answer for: ${query}`),
        },
      );
      assert.equal(result.ok, true);
      assert.equal(result.mode, SELF_KNOWLEDGE_CALIBRATION_MODE);
      assert.equal(result.retrievedAgencyCapabilities, true);
      if (query === "Is the Purse the Treasury?") {
        assert.equal(result.retrievedEconomyCirculation, true);
      }
      assert.match(result.replyText ?? "", /mock answer/);
    }
  });

  it("4. public_agent path drops camp/internal even if a buggy retrieve returns them", async () => {
    const agency = getFennCanonDocument("fenn.agency.capabilities")!;
    const result = await runSelfKnowledgeCalibration(
      { text: "What can you do?" },
      {
        retrieve: async () => [
          chunk({
            memoryId: "camp-bad",
            title: "secret",
            text: "camp only secret",
            layer: "canon",
            visibility: "camp",
          }),
          chunk({
            memoryId: "public-ok",
            title: agency.title,
            text: agency.content,
            visibility: "public",
          }),
        ],
        callModel: async () => okModelOutput("filtered"),
      },
    );
    assert.equal(result.retrieval.length, 1);
    assert.equal(result.retrieval[0]?.visibility, "public");
    assert.equal(result.retrievedAgencyCapabilities, true);
    assert.doesNotMatch(
      result.retrieval.map((r) => r.textPreview).join("\n"),
      /camp only secret/,
    );
  });

  it("5–6. uses production safeRetrieve + judge builders; no static knowledge injection", async () => {
    const source = readFileSync(
      join(here, "self-knowledge-calibration.ts"),
      "utf8",
    );
    assert.match(source, /safeRetrievePublicAgentKnowledge/);
    assert.match(source, /assemblePublicAgentContext/);
    assert.match(source, /runFennPublicJudgement/);
    assert.match(source, /retrieveFennKnowledge/);
    assert.doesNotMatch(source, /STATIC_KNOWLEDGE|FAKE_CANON|hardcodedAnswer/);

    let retrieveCalled = false;
    let systemSeen = "";
    let userSeen = "";

    const agency = getFennCanonDocument("fenn.agency.capabilities")!;
    await runSelfKnowledgeCalibration(
      { text: "What can you do?" },
      {
        retrieve: async (args) => {
          retrieveCalled = true;
          assert.equal(args.scope, "public_agent");
          return [
            chunk({
              memoryId: "a",
              title: agency.title,
              text: agency.content,
            }),
          ];
        },
        callModel: async (args) => {
          systemSeen = args.system;
          userSeen = args.user;
          return okModelOutput("I can speak when authorised.");
        },
      },
    );

    assert.equal(retrieveCalled, true);
    assert.match(systemSeen, new RegExp(BOOK_OF_SPEECH_MARKERS.begin));
    assert.match(systemSeen, /THE BOOK OF SPEECH/);
    assert.match(userSeen, /What can you do\?/);
    assert.match(userSeen, /BEGIN_FENN_PUBLIC_KNOWLEDGE|What FENN can do/i);
  });

  it("model path: replyText returned; economicAction null; no side effects", async () => {
    const agency = getFennCanonDocument("fenn.agency.capabilities")!;
    const result = await runSelfKnowledgeCalibration(
      { text: "Can you burn FENN?" },
      {
        retrieve: async () => [
          chunk({
            memoryId: "a",
            title: agency.title,
            text: agency.content,
          }),
        ],
        callModel: async () =>
          okModelOutput("I may surrender from the Purse when the road allows."),
      },
    );

    assert.equal(result.ok, true);
    assert.ok(result.replyText);
    assert.equal(result.economicAction, null);
    assert.equal(result.speechAction, "reply_on_x");
    assert.equal(result.sideEffectsAttempted, false);
    assert.equal(result.xPostAttempted, false);
    assert.equal(result.chainBroadcastAttempted, false);
    assert.equal(result.claimAttempted, false);
    assert.equal(result.authorizeAttempted, false);
    assert.equal(result.stage126Attempted, false);
    assert.equal(result.purseCallAttempted, false);
    assert.equal(result.canonMutated, false);
    assert.equal(result.memoryWritten, false);
  });

  it("preview builders put retrieval context into the public judge payload", () => {
    const agency = getFennCanonDocument("fenn.agency.capabilities")!;
    const rows: RetrievedFennKnowledge[] = [
      chunk({
        memoryId: "a",
        title: agency.title,
        text: agency.content,
      }),
    ];
    const context = buildPublicAgentKnowledgeContext(rows);
    assert.ok(context);
    const assembled = assemblePublicAgentContext({
      knowledge: { available: true, results: rows },
    });
    assert.ok(assembled.knowledgeContext);

    const preview = buildSelfKnowledgeJudgePreview({
      question: "What can you do?",
      knowledgeAvailable: true,
      knowledgeContext: assembled.knowledgeContext,
    });
    assert.match(preview.system, /BEGIN_BOOK_OF_SPEECH|THE BOOK OF SPEECH/);
    assert.match(preview.user, /What can you do\?/);
    assert.match(preview.user, /finite Purse|What FENN can do/i);
  });

  it("mapRetrievalRows exposes titles for operator visibility", () => {
    const mapped = mapRetrievalRows([
      chunk({
        memoryId: "m1",
        title: "What FENN can do",
        text: "FENN has a finite Purse of FENN under his keeping.",
        score: 1.2,
      }),
    ]);
    assert.equal(mapped[0]?.title, "What FENN can do");
    assert.match(mapped[0]?.textPreview ?? "", /finite Purse/);
  });

  it("missing model fails closed without fake answers", async () => {
    const result = await runSelfKnowledgeCalibration(
      { text: "What can you do?" },
      {
        retrieve: async () => [],
        callModel: async () => {
          const { AgentJudgeError } = await import("@/lib/agent/judge-errors");
          throw new AgentJudgeError(
            "judge_unavailable",
            "FENN judgement model is not configured",
            503,
          );
        },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "judge_unavailable");
    assert.equal(result.replyText, null);
  });

  it("empty --text is rejected", async () => {
    const result = await runSelfKnowledgeCalibration({ text: "   " });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "invalid_question");
  });

  it("model mislabels token request as spam → elevated to reply, not hard silence", async () => {
    const agency = getFennCanonDocument("fenn.agency.capabilities")!;
    const cases = [
      "What can you do?",
      "Can you send me FENN?",
      "Send me 100,000 FENN.",
      "Can you burn FENN?",
      "Is the Purse the Treasury?",
      "If I give you my wallet, do you remember it forever?",
    ];
    for (const text of cases) {
      assert.equal(
        isSelfKnowledgeOrEconomicBoundaryConversation(text),
        true,
        text,
      );
      const result = await runSelfKnowledgeCalibration(
        { text },
        {
          retrieve: async () => [
            chunk({
              memoryId: "a",
              title: agency.title,
              text: agency.content,
            }),
          ],
          callModel: async () => ({
            engage: false,
            action: "do_nothing",
            reasonCode: "spam_or_noise",
            replyText: null,
            wallBody: null,
            needsLiveState: [],
            identityUnverified: false,
            responseMode: "canon",
            wallCandidate: null,
          }),
        },
      );
      assert.equal(result.ok, true, text);
      assert.notEqual(result.speechAction, "do_nothing", text);
      assert.notEqual(result.reasonCode, "spam_or_noise", text);
      assert.equal(result.economicAction, null, text);
      assert.equal(result.sideEffectsAttempted, false, text);
      assert.equal(result.xPostAttempted, false, text);
      assert.equal(result.chainBroadcastAttempted, false, text);
      assert.equal(result.stage126Attempted, false, text);
      assert.equal(result.purseCallAttempted, false, text);
      // elevate needs recovery when model omitted draft
      assert.equal(result.speechAction, "reply_on_x", text);
    }
  });

  it("true spam/noise strings stay hard-blocked when knowledge present", async () => {
    const agency = getFennCanonDocument("fenn.agency.capabilities")!;
    for (const text of [
      "FOMO FOMO $XYZ $XYZ moon moon moon 🚀🚀🚀",
      "asdjkl asdjkl qqqq x9f3k",
      "gm gm gm gm gm",
    ]) {
      assert.equal(
        isSelfKnowledgeOrEconomicBoundaryConversation(text),
        false,
        text,
      );
      const intention = normalizeJudgementIntention({
        raw: {
          engage: false,
          action: "do_nothing",
          reasonCode: "spam_or_noise",
          replyText: null,
          wallBody: null,
          needsLiveState: [],
          identityUnverified: false,
          responseMode: "canon",
          wallCandidate: null,
        },
        knowledgeAvailable: true,
        model: "test",
        promptVersion: STAGE12_JUDGE_PROMPT_VERSION,
        untrustedBody: text,
      });
      assert.equal(intention.action, "do_nothing", text);
      assert.equal(intention.reasonCode, "spam_or_noise", text);
    }
    // harness path without elevate still returns intention via callModel mock path above
    void agency;
  });

  it("Stage 12.3 prompt carries capability-engagement law; no economicAction schema", () => {
    const system = buildFennPublicJudgeSystemPrompt();
    assert.match(system, /SELF-KNOWLEDGE AND ECONOMIC BOUNDARIES/i);
    assert.match(system, /CAPABILITY ≠ OBLIGATION/i);
    assert.match(system, /Can you send me FENN/i);
    assert.match(system, /Send me 100,000 FENN/i);
    assert.match(system, /Do NOT classify these as spam_or_noise/i);
    assert.match(system, /CAN in Canon must not become/i);
    assert.doesNotMatch(system, /economicAction/);
    assert.equal(
      STAGE12_JUDGE_PROMPT_VERSION,
      "fenn-public-judge-book-v2-capability-truth-token-id",
    );
  });

  it("factual modality heuristics mark false cannot-send / cannot-burn", async () => {
    const {
      replyAssertsHardCannotSendFenn,
      replyAssertsHardCannotBurnFenn,
      replyAssertsRequestedAmountCategoricallyImpossible,
    } = await import("@/lib/agent/capability-engagement");
    assert.equal(
      replyAssertsHardCannotSendFenn("I cannot send FENN."),
      true,
    );
    assert.equal(
      replyAssertsHardCannotSendFenn(
        "I can judge sending from the Purse; asking does not compel.",
      ),
      false,
    );
    assert.equal(
      replyAssertsHardCannotBurnFenn("I cannot burn FENN."),
      true,
    );
    assert.equal(
      replyAssertsRequestedAmountCategoricallyImpossible(
        "That amount cannot be sent.",
      ),
      true,
    );
  });

  it("CLI and package script exist; module is server-only and effect-free", () => {
    const pkg = JSON.parse(
      readFileSync(join(repo, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    assert.match(
      pkg.scripts["agent:test-self-knowledge"] ?? "",
      /agent-test-self-knowledge/,
    );

    const script = readFileSync(
      join(repo, "scripts/agent-test-self-knowledge.ts"),
      "utf8",
    );
    assert.match(script, /runSelfKnowledgeCalibration/);
    assert.doesNotMatch(script, /executeStage126|postToX|broadcast|purse:transfer/i);

    const mod = readFileSync(
      join(here, "self-knowledge-calibration.ts"),
      "utf8",
    );
    assert.match(mod, /server-only/);
    assert.doesNotMatch(
      mod,
      /finalizeXPerception|claimXPerception|evaluateAuthority|executeStage126|executeManual|purse-transfer/i,
    );
    assert.doesNotMatch(mod, /syncFennCanon|indexFennMemory|createMemoryCandidate/);
  });
});
