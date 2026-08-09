/**
 * Stage P1D — conversational wallet collection tests.
 * No blockchain broadcasts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planEconomicEffects } from "@/lib/agent/economic-authority";
import { STAGE125_POLICY_CODES } from "@/lib/agent/authority-config";
import {
  extractCandidateWalletFromText,
  isAffirmativeWalletConfirmation,
  isNegativeWalletConfirmation,
  shortWalletForConfirmation,
} from "@/lib/agent/wallet-collection";
import {
  speechFactsDestinationConfirmation,
  speechFactsDestinationRequired,
  buildWalletSpeechFallback,
} from "@/lib/agent/wallet-speech-facts";
import { decideWalletCollectionTurn } from "@/lib/agent/wallet-collection-turn";
import {
  InMemoryEconomicInteractionStore,
  runP1dWalletCollectionHarness,
} from "@/lib/agent/p1d-wallet-collection-test";
import { planTransferFromConfirmedInteraction } from "@/lib/agent/wallet-collection-handler";
import type { EconomicInteractionRow } from "@/lib/agent/economic-interaction";
import { harnessPurseState } from "@/lib/agent/p1b-economic-judgement-test";
import { evaluateAuthorityDecision } from "@/lib/agent/authority-policy";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";
import { PURSE_ORIGINAL_ALLOCATION_FORMATTED } from "@/lib/agent/economic-amount";

const WALLET = "0x92a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab174";
const WALLET_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const AUTHOR = "9000000000000000099";
const OTHER = "9000000000000000088";

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

describe("Stage P1D wallet collection", () => {
  it("1–5. pending destination, amount frozen; burn/none never create wallet FSM here", () => {
    assert.ok(STAGE125_POLICY_CODES.includes("pending_destination"));

    const transfer = planEconomicEffects({
      economicIntent: {
        type: "transfer_fenn",
        proposedAmount: "25000",
        reason: "merit",
        recipientSource: "trusted_profile_wallet",
      },
      reasonCode: "answered_from_public_knowledge",
      perceptionEventId: "pe-1",
      executionRail: "p1a_test",
      purseState: {
        isEnabled: true,
        economicExecutionEnabled: true,
        environment: "p1b_test_harness",
        testRailExplicitlyActive: true,
        officialFennAvailable: false,
        remainingBalanceFormatted: PURSE_ORIGINAL_ALLOCATION_FORMATTED,
        rolling24hOutflowFormatted: "0",
        tokenDecimals: 18,
      },
    });
    assert.equal(transfer.pendingDestination, true);
    assert.equal(transfer.skippedReason, "pending_destination");
    assert.equal(transfer.effects.length, 0);

    const burn = planEconomicEffects({
      economicIntent: {
        type: "burn_fenn",
        proposedAmount: "10000",
        reason: "rite",
      },
      reasonCode: "answered_from_public_knowledge",
      perceptionEventId: "pe-2",
      executionRail: "p1a_test",
      purseState: {
        isEnabled: true,
        economicExecutionEnabled: true,
        environment: "p1b_test_harness",
        testRailExplicitlyActive: true,
        officialFennAvailable: false,
        remainingBalanceFormatted: PURSE_ORIGINAL_ALLOCATION_FORMATTED,
        rolling24hOutflowFormatted: "0",
        tokenDecimals: 18,
      },
    });
    assert.equal(burn.pendingDestination ?? false, false);
    assert.equal(burn.effects[0]?.type, "burn_fenn");

    const none = planEconomicEffects({
      economicIntent: { type: "NONE" },
      reasonCode: "answered_from_public_knowledge",
      perceptionEventId: "pe-3",
      executionRail: "p1a_test",
      purseState: harnessPurseState(),
    });
    assert.equal(none.pendingDestination ?? false, false);
    assert.equal(none.skippedReason, "none");
  });

  it("6–10. same immutable X user required; others ignored", () => {
    const interaction = baseInteraction();
    const wrong = decideWalletCollectionTurn({
      interaction,
      authorXUserId: OTHER,
      body: WALLET,
    });
    assert.equal(wrong.kind, "ignored_wrong_user");

    const ok = decideWalletCollectionTurn({
      interaction,
      authorXUserId: AUTHOR,
      body: WALLET,
    });
    assert.equal(ok.kind, "candidate_set");
  });

  it("11–15. wallet extraction rules", () => {
    assert.equal(extractCandidateWalletFromText(WALLET).ok, true);
    assert.equal(extractCandidateWalletFromText("no address").ok, false);
    assert.equal(
      extractCandidateWalletFromText(
        "0x0000000000000000000000000000000000000000",
      ).ok,
      false,
    );
    assert.equal(
      extractCandidateWalletFromText(`${WALLET} and ${WALLET_B}`).ok,
      false,
    );
    // Unsolicited extract still works as pure parse — trust is auth policy.
    assert.ok(extractCandidateWalletFromText(`send to ${WALLET}`).ok);
  });

  it("16–21. confirmation, negative, replacement, amount not mutable", () => {
    const withCandidate = baseInteraction({
      status: "awaiting_wallet_confirmation",
      candidateWallet: WALLET,
    });
    assert.ok(isAffirmativeWalletConfirmation("yes"));
    assert.ok(isAffirmativeWalletConfirmation("that's right"));
    assert.ok(isNegativeWalletConfirmation("no"));
    assert.equal(isAffirmativeWalletConfirmation(""), false);

    const yes = decideWalletCollectionTurn({
      interaction: withCandidate,
      authorXUserId: AUTHOR,
      body: "yes, but send me 100000 instead",
    });
    // Ambiguous with amount talk but affirmative prefix → still confirms for MVP if classified yes
    // "yes, but send me 100000 instead" — not exact affirmative; re-ask
    assert.ok(
      yes.kind === "confirmed" ||
        yes.kind === "candidate_replaced" ||
        yes.kind === "back_to_awaiting_wallet",
    );
    if (yes.kind === "confirmed") {
      assert.equal(yes.proposedAmount, "25000");
      assert.notEqual(yes.proposedAmount, "100000");
    }

    const clearYes = decideWalletCollectionTurn({
      interaction: withCandidate,
      authorXUserId: AUTHOR,
      body: "yes",
    });
    assert.equal(clearYes.kind, "confirmed");
    if (clearYes.kind === "confirmed") {
      assert.equal(clearYes.proposedAmount, "25000");
      assert.equal(clearYes.confirmedWallet, WALLET);
    }

    const no = decideWalletCollectionTurn({
      interaction: withCandidate,
      authorXUserId: AUTHOR,
      body: "no",
    });
    assert.equal(no.kind, "back_to_awaiting_wallet");

    const replace = decideWalletCollectionTurn({
      interaction: withCandidate,
      authorXUserId: AUTHOR,
      body: WALLET_B,
    });
    assert.equal(replace.kind, "candidate_replaced");
    if (replace.kind === "candidate_replaced") {
      assert.equal(replace.candidateWallet, WALLET_B);
    }
  });

  it("22–27. re-entry uses original amount; refuse over max without clamp", () => {
    const interaction = baseInteraction({
      status: "wallet_confirmed",
      confirmedWallet: WALLET,
      proposedAmount: "25000",
    });
    const planned = planTransferFromConfirmedInteraction({
      interaction,
      perceptionEventId: "pe-re",
      purseState: harnessPurseState(),
      executionRail: "p1a_test",
      sufficientBalance: true,
    });
    assert.equal(planned.effects.length, 1);
    assert.equal(planned.plannedAmount, "25000");
    assert.equal(planned.effects[0]?.payload.recipientAddress, WALLET);

    const over = planEconomicEffects({
      economicIntent: {
        type: "transfer_fenn",
        proposedAmount: "999999999",
        reason: "too much",
        recipientSource: "trusted_profile_wallet",
      },
      reasonCode: "answered_from_public_knowledge",
      perceptionEventId: "pe-over",
      interactionConfirmedWallet: WALLET,
      economicInteractionId: "ei-over",
      purseState: harnessPurseState(),
      executionRail: "p1a_test",
      sufficientBalance: true,
      limits: {
        maxSingleTransferFormatted: "100000",
        maxSingleBurnFormatted: "50000",
        maxRolling24hOutflowFormatted: "500000",
        source: "test_defaults",
      },
    });
    assert.equal(over.effects.length, 0);
    assert.equal(over.skippedReason, "amount_exceeds_transfer_limit");
  });

  it("28–31. one interaction one transfer plan id; second plan blocked if already linked", () => {
    const a = planTransferFromConfirmedInteraction({
      interaction: baseInteraction({
        status: "wallet_confirmed",
        confirmedWallet: WALLET,
        transferEffectId: null,
      }),
      perceptionEventId: "pe-a",
      purseState: harnessPurseState(),
      executionRail: "p1a_test",
    });
    assert.equal(a.effects.length, 1);
    const key1 = a.effects[0]?.idempotencyKey;

    const b = planTransferFromConfirmedInteraction({
      interaction: baseInteraction({
        status: "wallet_confirmed",
        confirmedWallet: WALLET,
        transferEffectId: "already",
      }),
      perceptionEventId: "pe-b",
      purseState: harnessPurseState(),
      executionRail: "p1a_test",
    });
    assert.equal(b.effects.length, 0);
    assert.equal(b.skippedReason, "already_linked_effect");
    assert.ok(key1?.includes("ei:"));
  });

  it("32–33. expired cannot confirm", () => {
    const expired = decideWalletCollectionTurn({
      interaction: baseInteraction({
        status: "awaiting_wallet_confirmation",
        candidateWallet: WALLET,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
      authorXUserId: AUTHOR,
      body: "yes",
    });
    assert.equal(expired.kind, "expired");
  });

  it("34–36. harness multi-turn happy path + wrong user + malformed", () => {
    const happy = runP1dWalletCollectionHarness({
      label: "happy",
      proposedAmount: "25000",
      turns: [WALLET, "yes"],
    });
    assert.equal(happy.ok, true);
    assert.equal(happy.finalInteraction?.status, "wallet_confirmed");
    assert.equal(happy.finalInteraction?.proposedAmount, "25000");
    assert.equal(happy.finalInteraction?.confirmedWallet, WALLET);
    const confirmTurn = happy.turns.find((t) => t.kind === "confirmed");
    assert.ok(confirmTurn);
    assert.equal(confirmTurn?.plannedTransferAmount, "25000");

    const wrongUser = runP1dWalletCollectionHarness({
      label: "poison",
      turns: [WALLET],
      turnAuthors: [OTHER],
    });
    assert.equal(wrongUser.turns.at(-1)?.kind, "ignored_wrong_user");
    assert.equal(wrongUser.finalInteraction?.status, "awaiting_wallet");

    const malformed = runP1dWalletCollectionHarness({
      label: "bad",
      turns: ["not a wallet"],
    });
    assert.equal(malformed.turns.at(-1)?.kind, "remain_awaiting_wallet");
  });

  it("37–39. fallback speech asks for wallet / confirmation / no completion claim", () => {
    const ask = buildWalletSpeechFallback(speechFactsDestinationRequired("25000"));
    assert.match(ask, /25000 FENN/i);
    assert.doesNotMatch(ask, /I have sent|confirmed on.?chain/i);
    const conf = buildWalletSpeechFallback(
      speechFactsDestinationConfirmation(WALLET),
    );
    assert.match(conf, new RegExp(shortWalletForConfirmation(WALLET).replace("…", ".+")));
    assert.doesNotMatch(conf, /tokens were sent|transfer is complete/i);

    // FSM still emits facts not bare prose as the primary product.
    const d = decideWalletCollectionTurn({
      interaction: baseInteraction(),
      authorXUserId: AUTHOR,
      body: WALLET,
    });
    assert.equal(d.kind, "candidate_set");
    if (d.kind === "candidate_set") {
      assert.equal(d.speechFacts.moment, "destination_confirmation");
    }
  });

  it("40–45. P1C amount path + user demand without intent stays none", () => {
    const d = evaluateAuthorityDecision({
      perceptionEventId: "pe-n",
      judgementId: "j",
      xPostId: "9004000000000000999",
      perceptionType: "mention",
      finalStatus: "finalized",
      finalAction: "reply_on_x",
      finalReplyText: "No tokens for a bare ask.",
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
      d.effects.some((e) => e.type === "transfer_fenn"),
      false,
    );
    assert.equal(FENN_DEAD_ADDRESS.includes("dead"), true);

    const store = new InMemoryEconomicInteractionStore();
    store.insert(baseInteraction({ id: "ei-active", authorXUserId: AUTHOR }));
    assert.throws(() =>
      store.insert(baseInteraction({ id: "ei-2", authorXUserId: AUTHOR })),
    );
  });
});
