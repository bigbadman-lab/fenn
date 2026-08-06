/**
 * Stage 4 — THE BOOK OF SPEECH v2 regression + injection tests.
 */
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
import { buildReplyRecoverySystemPrompt } from "@/lib/agent/reply-recovery-prompt";
import { STAGE12_REPLY_RECOVERY_PROMPT_VERSION } from "@/lib/agent/reply-recovery-schema";

describe("THE BOOK OF SPEECH v2", () => {
  it("exports a stable version and title", () => {
    assert.equal(BOOK_OF_SPEECH_VERSION, "book-of-speech-v2");
    assert.equal(BOOK_OF_SPEECH_TITLE, "THE BOOK OF SPEECH");
    assert.match(buildBookOfSpeechPrecedenceNote(), /book-of-speech-v2/);
    assert.match(buildBookOfSpeechPrecedenceNote(), /Truth outranks voice/i);
  });

  it("canon block is framed and includes constitution sections", () => {
    const block = buildBookOfSpeechCanonBlock();
    assert.match(block, new RegExp(BOOK_OF_SPEECH_MARKERS.begin));
    assert.match(block, new RegExp(BOOK_OF_SPEECH_MARKERS.end));
    assert.match(block, /THE BOOK OF SPEECH/);
    assert.match(block, /book-of-speech-v2/);
    assert.match(block, /Answer the actual question first/i);
    assert.match(block, /Facts are not decoration/i);
    assert.match(block, /Commit when invited/i);
    assert.match(block, /Never invent or paraphrase the address|exact trusted contract/i);
    assert.match(block, /No official contract has been carved into the Register/);
  });

  it("forbids generic AI / product / therapist stock register", () => {
    const block = buildBookOfSpeechCanonBlock().toLowerCase();
    const mustTeach = [
      "within the fenn world",
      "reflective and subjective",
      "your journey",
      "ecosystem",
      "as an ai",
      "platform",
      "consider what resonates",
    ];
    for (const phrase of mustTeach) {
      assert.ok(
        block.includes(phrase),
        `constitution should teach avoidance of: ${phrase}`,
      );
    }
    void BOOK_OF_SPEECH_FORBIDDEN_STOCK_PHRASES;
  });

  it("includes Greenwood, law, and count few-shots", () => {
    const block = buildBookOfSpeechCanonBlock();
    assert.match(block, /What is the Greenwood/);
    assert.match(block, /law should be carved above the entrance/i);
    assert.match(block, /confirmed_outlaw_count\s*=\s*2|count \(hypothetical/i);
    assert.match(block, /NOTHING ENTERS THE GREENWOOD|create immediately/i);
  });

  it("Stage 12.3 system prompt includes the Book of Speech v2", () => {
    const system = buildFennPublicJudgeSystemPrompt();
    assert.match(system, /BEGIN_BOOK_OF_SPEECH/);
    assert.match(system, /book-of-speech-v2/);
    assert.match(system, /Apply THE BOOK OF SPEECH to every replyText and wallBody/);
    assert.match(system, new RegExp(STAGE12_JUDGE_PROMPT_VERSION));
    assert.equal(STAGE12_JUDGE_PROMPT_VERSION, "fenn-public-judge-book-v2");
    assert.match(system, /VISIBLE REPLY GUARANTEE/i);
    assert.match(system, /Wall always requires a reply|no wall-only action/i);
    assert.match(system, /will this still matter in a year/i);
    assert.match(system, /user demand does not force/i);
    for (const action of STAGE12_AGENT_ACTIONS) {
      assert.match(system, new RegExp(action));
    }
    assert.doesNotMatch(system, /^- write_to_wall$/m);
    assert.match(system, new RegExp(FENN_UNTRUSTED_X_MARKERS.begin));
  });

  it("Stage 12.4 final system prompt includes the Book of Speech v2", () => {
    const system = buildFennPublicFinalJudgeSystemPrompt();
    assert.match(system, /BEGIN_BOOK_OF_SPEECH/);
    assert.match(system, /book-of-speech-v2/);
    assert.match(
      system,
      /Live context does not authorise generic assistant/,
    );
    assert.equal(
      STAGE124_FINAL_PROMPT_VERSION,
      "fenn-public-final-judge-book-v2",
    );
    assert.match(system, new RegExp(STAGE124_FINAL_PROMPT_VERSION));
    assert.doesNotMatch(system, /needsLiveState/);
    assert.match(system, /X REPLY vs WALL/i);
  });

  it("recovery system prompt includes Book v2", () => {
    const system = buildReplyRecoverySystemPrompt();
    assert.match(system, /BEGIN_BOOK_OF_SPEECH/);
    assert.match(system, /book-of-speech-v2/);
    assert.equal(
      STAGE12_REPLY_RECOVERY_PROMPT_VERSION,
      "fenn-public-reply-recovery-book-v2",
    );
  });

  it("does not alter action schema validation surface", () => {
    assert.deepEqual([...STAGE12_AGENT_ACTIONS], [
      "do_nothing",
      "reply_on_x",
      "reply_and_write_to_wall",
    ]);
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
