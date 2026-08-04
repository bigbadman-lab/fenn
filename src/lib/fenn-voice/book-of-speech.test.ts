import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFennPublicJudgeSystemPrompt } from "@/lib/agent/judge-prompt";
import { STAGE12_JUDGE_PROMPT_VERSION } from "@/lib/agent/judge-config";
import {
  buildFennPublicFinalJudgeSystemPrompt,
  STAGE124_FINAL_PROMPT_VERSION,
} from "@/lib/agent/stage124-final-judge-prompt";
import { STAGE12_AGENT_ACTIONS } from "@/lib/agent/actions";
import { FENN_UNTRUSTED_X_MARKERS } from "@/lib/agent/judge-prompt";
import {
  BOOK_OF_SPEECH_FORBIDDEN_STOCK_PHRASES,
  BOOK_OF_SPEECH_MARKERS,
  BOOK_OF_SPEECH_TITLE,
  BOOK_OF_SPEECH_VERSION,
  buildBookOfSpeechCanonBlock,
  buildBookOfSpeechPrecedenceNote,
} from "@/lib/fenn-voice/book-of-speech";
import { parseJudgementModelOutput } from "@/lib/agent/judge-schema";
import { FENN_PUBLIC_KNOWLEDGE_MARKERS } from "@/lib/agent/context";

describe("THE BOOK OF SPEECH v1", () => {
  it("exports a stable version and title", () => {
    assert.equal(BOOK_OF_SPEECH_VERSION, "book-of-speech-v1");
    assert.equal(BOOK_OF_SPEECH_TITLE, "THE BOOK OF SPEECH");
    assert.match(buildBookOfSpeechPrecedenceNote(), /book-of-speech-v1/);
  });

  it("canon block is framed and includes constitution sections", () => {
    const block = buildBookOfSpeechCanonBlock();
    assert.match(block, new RegExp(BOOK_OF_SPEECH_MARKERS.begin));
    assert.match(block, new RegExp(BOOK_OF_SPEECH_MARKERS.end));
    assert.match(block, /THE BOOK OF SPEECH/);
    assert.match(block, /book-of-speech-v1/);
    assert.match(block, /Answer the actual question/);
    assert.match(block, /clarity outranks poetry/i);
    assert.match(block, /Never invent or paraphrase the address|never invent or paraphrase the address/i);
    assert.match(block, /exact retrieved canonical address/i);
    assert.match(block, /No official contract has been carved into the Register/);
    assert.match(block, /The Book does not hold that answer/);
  });

  it("forbids generic AI / product / therapist stock register", () => {
    const block = buildBookOfSpeechCanonBlock();
    for (const phrase of BOOK_OF_SPEECH_FORBIDDEN_STOCK_PHRASES) {
      assert.match(
        block,
        new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
        `constitution should teach avoidance of: ${phrase}`,
      );
    }
    assert.match(block, /reflective and subjective/i);
    assert.match(block, /resonates with/i);
    assert.match(block, /your journey/i);
    assert.match(block, /corporate/i);
    assert.match(block, /platform/i);
  });

  it("includes Greenwood and law-above-the-entrance examples", () => {
    const block = buildBookOfSpeechCanonBlock();
    assert.match(block, /What is the Greenwood/);
    assert.match(block, /standing becomes belonging/);
    assert.match(block, /law should be carved above the entrance/i);
    assert.match(block, /Leave the Greenwood richer than you found it/);
    assert.match(
      block,
      /deeper realm within the FENN world where membership is a lasting change/,
    );
  });

  it("Stage 12.3 system prompt includes the Book of Speech", () => {
    const system = buildFennPublicJudgeSystemPrompt();
    assert.match(system, /BEGIN_BOOK_OF_SPEECH/);
    assert.match(system, /book-of-speech-v1/);
    assert.match(system, /Apply THE BOOK OF SPEECH to every replyText and wallBody/);
    assert.match(system, new RegExp(STAGE12_JUDGE_PROMPT_VERSION));
    assert.equal(
      STAGE12_JUDGE_PROMPT_VERSION,
      "fenn-public-judge-wall-requires-reply-v1",
    );
    // Operational boundaries preserved
    assert.match(system, /Silence is a first-class decision/);
    assert.match(system, /Wall always requires a reply|no wall-only action/i);
    assert.match(system, /will this still matter in a year/i);
    assert.match(system, /user demand does not force/i);
    assert.match(system, /PUBLIC KNOWLEDGE|reference DATA|REFERENCE DATA/i);
    for (const action of STAGE12_AGENT_ACTIONS) {
      assert.match(system, new RegExp(action));
    }
    assert.doesNotMatch(system, /^- write_to_wall$/m);
    assert.match(system, new RegExp(FENN_UNTRUSTED_X_MARKERS.begin));
    assert.match(system, new RegExp(FENN_UNTRUSTED_X_MARKERS.end));
  });

  it("Stage 12.4 final system prompt includes the Book of Speech", () => {
    const system = buildFennPublicFinalJudgeSystemPrompt();
    assert.match(system, /BEGIN_BOOK_OF_SPEECH/);
    assert.match(system, /book-of-speech-v1/);
    assert.match(
      system,
      /Live context does not authorise generic assistant/,
    );
    assert.match(system, /write_to_wall/);
    assert.match(system, /Trusted live state is authoritative for current truth/);
    assert.equal(
      STAGE124_FINAL_PROMPT_VERSION,
      "fenn-public-final-judge-wall-requires-reply-v1",
    );
    assert.match(system, new RegExp(STAGE124_FINAL_PROMPT_VERSION));
    assert.doesNotMatch(system, /needsLiveState/);
    assert.match(system, /Wall always requires a reply|no wall-only action/i);
    assert.match(system, /will this still matter in a year/i);
  });

  it("does not alter action schema validation surface", () => {
    assert.deepEqual([...STAGE12_AGENT_ACTIONS], [
      "do_nothing",
      "reply_on_x",
      "reply_and_write_to_wall",
    ]);
    assert.ok(!STAGE12_AGENT_ACTIONS.includes("write_to_wall" as never));
    const parsed = parseJudgementModelOutput({
      engage: true,
      action: "reply_on_x",
      reasonCode: "answered_from_public_knowledge",
      replyText: "Thirty LEAF opens the Greenwood.",
      wallBody: null,
      needsLiveState: [],
      identityUnverified: false,
    });
    assert.equal(parsed.action, "reply_on_x");
  });

  it("knowledge markers remain available to stage prompts", () => {
    assert.ok(FENN_PUBLIC_KNOWLEDGE_MARKERS.begin);
    assert.ok(FENN_PUBLIC_KNOWLEDGE_MARKERS.end);
  });
});
