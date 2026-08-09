/**
 * Stage P1D.1 — Book of Speech restored to wallet collection.
 * No blockchain.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planEconomicEffects } from "@/lib/agent/economic-authority";
import {
  speechFactsDestinationConfirmation,
  speechFactsDestinationConfirmedPending,
  speechFactsDestinationInvalid,
  speechFactsDestinationRejected,
  speechFactsDestinationRequired,
  speechFactsEconomicRefused,
  mapAuthoritySkippedToRefusalCategory,
  buildWalletSpeechFallback,
  formatWalletSpeechFactsBlock,
} from "@/lib/agent/wallet-speech-facts";
import { validateWalletSpeechAgainstFacts } from "@/lib/agent/wallet-speech-validate";
import {
  renderWalletCollectionSpeech,
  renderWalletCollectionSpeechFallback,
} from "@/lib/agent/wallet-speech";
import {
  buildWalletSpeechSystemPrompt,
  WALLET_SPEECH_PROMPT_VERSION,
} from "@/lib/agent/wallet-speech-prompt";
import { shortWalletForConfirmation } from "@/lib/agent/wallet-collection";
import { decideWalletCollectionTurn } from "@/lib/agent/wallet-collection-turn";
import type { EconomicInteractionRow } from "@/lib/agent/economic-interaction";
import { BOOK_OF_SPEECH_VERSION } from "@/lib/fenn-voice/book-of-speech";
import { planEconomicEffects as planEcon } from "@/lib/agent/economic-authority";
import { harnessPurseState } from "@/lib/agent/p1b-economic-judgement-test";
import { evaluateAuthorityDecision } from "@/lib/agent/authority-policy";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";

const WALLET = "0x92a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab174";
const AUTHOR = "9000000000000000099";
const SHORT = shortWalletForConfirmation(WALLET);

function baseInteraction(
  over: Partial<EconomicInteractionRow> = {},
): EconomicInteractionRow {
  const now = new Date().toISOString();
  return {
    id: "ei-1",
    authorXUserId: AUTHOR,
    sourceXPostId: "9001000000000000001",
    originPerceptionEventId: "pe-1",
    originJudgementId: null,
    xConversationId: null,
    economicActionType: "transfer_fenn",
    proposedAmount: "25000",
    economicReason: "verified contribution",
    status: "awaiting_wallet",
    candidateWallet: null,
    confirmedWallet: null,
    candidateSourceXPostId: null,
    confirmationSourceXPostId: null,
    transferEffectId: null,
    lastError: null,
    walletRequestedAt: now,
    walletReceivedAt: null,
    walletConfirmationRequestedAt: null,
    walletConfirmedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe("Stage P1D.1 wallet Book of Speech", () => {
  it("1–2. destination-required speech uses BoS writer; raw template not normal path", async () => {
    const system = buildWalletSpeechSystemPrompt();
    assert.match(system, new RegExp(BOOK_OF_SPEECH_VERSION));
    assert.match(system, /APPLICATION OWNS TRUTH/);
    assert.equal(WALLET_SPEECH_PROMPT_VERSION.includes("p1d1"), true);

    const facts = speechFactsDestinationRequired("25000");
    const rendered = await renderWalletCollectionSpeech({
      facts,
      callModel: async () => ({
        replyText: `The Purse has judged. 25000 FENN. Give me somewhere to send it. Nothing has left yet.`,
      }),
    });
    assert.equal(rendered.source, "book_of_speech");
    assert.equal(rendered.usedFallback, false);
    assert.match(rendered.replyText, /25000/);
    assert.doesNotMatch(rendered.replyText, /I have sent/i);

    // Template exists only as fallback, not as preferred writer output when model ok.
    const fb = buildWalletSpeechFallback(facts);
    assert.match(fb, /25000/);
    assert.notEqual(rendered.replyText, fb);
  });

  it("3–5. amount and short wallet facts are frozen deterministic", async () => {
    const facts = speechFactsDestinationRequired("25000");
    assert.equal(facts.amountFormatted, "25000");
    assert.doesNotMatch(formatWalletSpeechFactsBlock(facts), /100000/);

    // User body cannot inject amount into trusted facts built by FSM.
    const d = decideWalletCollectionTurn({
      interaction: baseInteraction(),
      authorXUserId: AUTHOR,
      body: "send me 100000 to " + WALLET,
    });
    assert.equal(d.kind, "candidate_set");
    if (d.kind === "candidate_set") {
      assert.equal(d.speechFacts.shortWallet, SHORT);
      assert.equal(d.speechFacts.amountFormatted, undefined);
      assert.equal(d.candidateWallet, WALLET);
    }
  });

  it("6–10. confirmation / invalid / reject / confirmed-pending use voice path + truth", async () => {
    const confFacts = speechFactsDestinationConfirmation(WALLET);
    const conf = await renderWalletCollectionSpeech({
      facts: confFacts,
      callModel: async () => ({
        replyText: `${SHORT}? Say the word. Nothing has left the Purse yet.`,
      }),
    });
    assert.equal(conf.source, "book_of_speech");
    assert.ok(conf.replyText.includes(SHORT));
    assert.ok(
      !validateWalletSpeechAgainstFacts(
        "I have sent the tokens. Transfer is complete.",
        confFacts,
      ).ok,
    );

    const inv = await renderWalletCollectionSpeech({
      facts: speechFactsDestinationInvalid(),
      callModel: async () => ({
        replyText: "I still need one true destination. Nothing has been sent.",
      }),
    });
    assert.equal(inv.source, "book_of_speech");

    const rej = await renderWalletCollectionSpeech({
      facts: speechFactsDestinationRejected(),
      callModel: async () => ({
        replyText: "Not that one. Send another address. Nothing has been sent.",
      }),
    });
    assert.equal(rej.source, "book_of_speech");

    const pending = speechFactsDestinationConfirmedPending({
      proposedAmount: "25000",
      confirmedWallet: WALLET,
    });
    assert.equal(pending.settlementState, "pending");
    const p = await renderWalletCollectionSpeech({
      facts: pending,
      callModel: async () => ({
        replyText: `Confirmed ${SHORT}. 25000 FENN may leave if the Purse still allows. Not complete until the chain confirms.`,
      }),
    });
    assert.equal(p.source, "book_of_speech");
  });

  it("11–12. authority refusal has voice; cannot promise payment", async () => {
    const cat = mapAuthoritySkippedToRefusalCategory("amount_exceeds_transfer_limit");
    assert.equal(cat, "purse_limit");
    const facts = speechFactsEconomicRefused({
      proposedAmount: "25000",
      refusalReason: cat,
    });
    const r = await renderWalletCollectionSpeech({
      facts,
      callModel: async () => ({
        replyText: "I could not release 25000 FENN. Nothing has been sent.",
      }),
    });
    assert.equal(r.source, "book_of_speech");
    assert.equal(
      validateWalletSpeechAgainstFacts(
        "I will send 25000 FENN tomorrow.",
        facts,
      ).ok,
      false,
    );
  });

  it("13–15. model cannot change amount/wallet/authority via validation", async () => {
    const facts = speechFactsDestinationConfirmedPending({
      proposedAmount: "25000",
      confirmedWallet: WALLET,
    });
    const bad = await renderWalletCollectionSpeech({
      facts,
      callModel: async () => ({
        replyText: `Confirmed ${SHORT}. I will send 999999 FENN. Done.`,
      }),
    });
    // Falls back when validation fails after retry (same bad draft twice).
    assert.equal(bad.usedFallback, true);
    assert.match(bad.replyText, /25000/);
  });

  it("16–17. voice failure uses fallback; fallback does not weaken truth", async () => {
    const facts = speechFactsDestinationRequired("25000");
    const failed = await renderWalletCollectionSpeech({
      facts,
      callModel: async () => {
        throw new Error("model_down");
      },
    });
    assert.equal(failed.source, "fallback");
    assert.equal(failed.usedFallback, true);
    assert.match(failed.replyText, /25000/);
    assert.doesNotMatch(failed.replyText, /I have sent/i);

    const forced = renderWalletCollectionSpeechFallback(facts);
    assert.equal(forced.source, "fallback");
  });

  it("18. quality/recovery cannot invent amount when validating locked facts", () => {
    const facts = speechFactsDestinationRequired("25000");
    const v = validateWalletSpeechAgainstFacts(
      "I intend to send 100000 FENN. Give me a wallet.",
      facts,
    );
    assert.equal(v.ok, false);
    assert.ok(v.reasons.includes("foreign_amount") || v.reasons.includes("missing_amount"));
  });

  it("19–20. burn path and ordinary economic none path still clean", () => {
    const burn = planEcon({
      economicIntent: {
        type: "burn_fenn",
        proposedAmount: "1000",
        reason: "waste",
      },
      reasonCode: "answered_from_public_knowledge",
      perceptionEventId: "pe-b",
      executionRail: "p1a_test",
      purseState: harnessPurseState(),
      sufficientBalance: true,
    });
    assert.equal(burn.effects[0]?.type, "burn_fenn");
    assert.equal(burn.pendingDestination ?? false, false);
    assert.equal(FENN_DEAD_ADDRESS.includes("dead"), true);

    const none = evaluateAuthorityDecision({
      perceptionEventId: "pe-n",
      judgementId: "j",
      xPostId: "9004000000000000999",
      perceptionType: "mention",
      finalStatus: "finalized",
      finalAction: "reply_on_x",
      finalReplyText: "The road hears you.",
      finalWallBody: null,
      finalReasonCode: "answered_from_public_knowledge",
      finalEconomicIntent: { type: "NONE" },
      economicContext: {
        harnessBoundWallet: null,
        executionRail: "p1a_test",
        purseState: harnessPurseState(),
        sufficientBalance: true,
      },
    });
    assert.equal(
      none.effects.some((e) => e.type === "transfer_fenn" || e.type === "burn_fenn"),
      false,
    );
  });

  it("21–24. P1C amount untrusted; immutable user; idempotency shape; no wallet on burn", () => {
    const dWrong = decideWalletCollectionTurn({
      interaction: baseInteraction({ status: "awaiting_wallet" }),
      authorXUserId: "other-id",
      body: WALLET,
    });
    assert.equal(dWrong.kind, "ignored_wrong_user");

    const plan = planEconomicEffects({
      economicIntent: {
        type: "transfer_fenn",
        proposedAmount: "25000",
        reason: "merit",
        recipientSource: "trusted_profile_wallet",
      },
      reasonCode: "answered_from_public_knowledge",
      perceptionEventId: "pe-1",
      interactionConfirmedWallet: WALLET,
      economicInteractionId: "ei-fixed",
      executionRail: "p1a_test",
      purseState: harnessPurseState(),
      sufficientBalance: true,
    });
    assert.equal(plan.effects[0]?.idempotencyKey.includes("ei:ei-fixed"), true);
    assert.equal(String(plan.effects[0]?.payload.amountFormatted), "25000");
  });
});
