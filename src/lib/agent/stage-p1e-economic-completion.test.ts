/**
 * Stage P1E — economic completion speech + Stage 12 effect planning tests.
 * No X posts. No blockchain.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  allowTestEconomicFollowupX,
  buildEconomicCompletionFacts,
  buildEconomicCompletionFallback,
  buildEconomicFollowupDraft,
  settlementAllowsCompletionSpeech,
  stage12EconomicFollowupReplyIdempotencyKey,
  validateEconomicCompletionSpeech,
} from "@/lib/agent/economic-followup";
import { buildEconomicCompletionSpeechSystemPrompt } from "@/lib/agent/economic-completion-prompt";
import { renderEconomicCompletionSpeech } from "@/lib/agent/economic-completion-speech";
import { planEconomicCompletionFollowup } from "@/lib/agent/economic-completion-plan";
import { runP1eEconomicCompletionHarness } from "@/lib/agent/p1e-economic-completion-test";
import { explorerTxUrl } from "@/lib/greenwood/hollow/explorer";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { BOOK_OF_SPEECH_VERSION } from "@/lib/fenn-voice/book-of-speech";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";

const TX =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WALLET = "0x92a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab174";
const POST = "9104000000000000999";

function factsTransfer(over: Partial<Parameters<typeof buildEconomicCompletionFacts>[0]> = {}) {
  return buildEconomicCompletionFacts({
    actionType: "transfer",
    amountFormatted: "25000",
    txHash: TX,
    confirmedAt: "2026-08-09T12:00:00.000Z",
    isTest: true,
    economicEffectId: "eff-tr-1",
    replyToXPostId: POST,
    recipientAddress: WALLET,
    ...over,
  });
}

describe("Stage P1E economic completion", () => {
  it("1–4. confirmed transfer/burn facts + explorer", () => {
    const tr = factsTransfer();
    assert.ok(tr);
    assert.equal(tr!.amountFormatted, "25000");
    assert.equal(tr!.recipientAddress.toLowerCase(), WALLET.toLowerCase());
    assert.equal(tr!.explorerUrl, explorerTxUrl(ROBINHOOD_CHAIN_ID, TX));
    assert.ok(tr!.shortRecipient);

    const br = buildEconomicCompletionFacts({
      actionType: "burn",
      amountFormatted: "50000",
      txHash: TX,
      confirmedAt: "2026-08-09T12:00:00.000Z",
      isTest: true,
      economicEffectId: "eff-b-1",
      replyToXPostId: POST,
      recipientAddress: FENN_DEAD_ADDRESS,
    });
    assert.ok(br);
    assert.equal(br!.amountFormatted, "50000");
    assert.equal(
      br!.recipientAddress.toLowerCase(),
      FENN_DEAD_ADDRESS.toLowerCase(),
    );
  });

  it("5–9. settlement ordering: only confirmed eligible", () => {
    assert.equal(settlementAllowsCompletionSpeech("pending"), false);
    assert.equal(settlementAllowsCompletionSpeech("submitted"), false);
    assert.equal(settlementAllowsCompletionSpeech("ambiguous"), false);
    assert.equal(settlementAllowsCompletionSpeech("failed"), false);
    assert.equal(settlementAllowsCompletionSpeech("confirmed"), true);

    // Not confirmed timestamp → planner skips
  });

  it("10–18. Book of Speech path + fact locks", async () => {
    const system = buildEconomicCompletionSpeechSystemPrompt();
    assert.match(system, new RegExp(BOOK_OF_SPEECH_VERSION));
    assert.match(system, /APPLICATION OWNS TRUTH/);

    const f = factsTransfer()!;
    const good = await renderEconomicCompletionSpeech({
      facts: f,
      callModel: async () => ({
        replyText: `25000 FENN left the Purse for ${f.shortRecipient}. Proof: ${f.explorerUrl}`,
      }),
    });
    assert.equal(good.source, "book_of_speech");
    assert.match(good.replyText, /25000/);
    assert.ok(good.replyText.includes(f.explorerUrl));

    const badAmount = await renderEconomicCompletionSpeech({
      facts: f,
      callModel: async () => ({
        replyText: `999999 FENN left. ${f.explorerUrl}`,
      }),
    });
    assert.equal(badAmount.usedFallback, true);
    assert.match(badAmount.replyText, /25000/);

    const burnF = buildEconomicCompletionFacts({
      actionType: "burn",
      amountFormatted: "50000",
      txHash: TX,
      confirmedAt: "2026-08-09T12:00:00.000Z",
      isTest: true,
      economicEffectId: "eff-b",
      replyToXPostId: POST,
    })!;
    const burnSpeech = await renderEconomicCompletionSpeech({
      facts: burnF,
      callModel: async () => ({
        replyText: `50000 FENN will not return. Proof: ${burnF.explorerUrl}`,
      }),
    });
    assert.equal(burnSpeech.source, "book_of_speech");
    assert.equal(
      validateEconomicCompletionSpeech(
        `50000 FENN burned and total supply reduced. ${burnF.explorerUrl}`,
        burnF,
      ).ok,
      false,
    );

    assert.equal(
      validateEconomicCompletionSpeech(
        `25000 FENN to dead address will not return. ${f.explorerUrl}`,
        f,
      ).ok,
      false,
    );
  });

  it("19–24. effect plan idempotency key + dry-run no persist", async () => {
    const key1 = stage12EconomicFollowupReplyIdempotencyKey("eff-1");
    assert.equal(key1, "stage12:economic_followup:eff-1");
    assert.equal(stage12EconomicFollowupReplyIdempotencyKey("eff-1"), key1);

    const plan = await planEconomicCompletionFollowup({
      actionType: "transfer",
      amountFormatted: "25000",
      txHash: TX,
      confirmedAt: "2026-08-09T12:00:00.000Z",
      isTest: true,
      economicEffectId: "eff-plan-1",
      sourceXPostId: POST,
      authorizationId: "00000000-0000-4000-8000-000000000099",
      perceptionEventId: "00000000-0000-4000-8000-000000000098",
      recipientAddress: WALLET,
      dryRun: true,
      forceSpeechFallback: true,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.replyEffectPlanned, true);
    assert.equal(plan.replyEffectPersisted, false);
    assert.equal(plan.skippedReason, "dry_run");
    assert.equal(plan.idempotencyKey, "stage12:economic_followup:eff-plan-1");
    assert.equal(plan.facts?.replyToXPostId, POST);
    assert.ok(plan.speech?.replyText);

    // test isolation default
    assert.equal(allowTestEconomicFollowupX(), false);
  });

  it("25–28. interaction status laws (documented via completion facts requiring confirmedAt)", async () => {
    const noConfirm = await planEconomicCompletionFollowup({
      actionType: "transfer",
      amountFormatted: "25000",
      txHash: TX,
      confirmedAt: "",
      isTest: true,
      economicEffectId: "x",
      sourceXPostId: POST,
      authorizationId: "a",
      perceptionEventId: "p",
      recipientAddress: WALLET,
      dryRun: true,
    });
    assert.equal(noConfirm.skippedReason, "not_confirmed");
    assert.equal(noConfirm.replyEffectPlanned, false);
  });

  it("harness transfer + burn dry-run", async () => {
    const r = await runP1eEconomicCompletionHarness({
      label: "demo",
      forceSpeechFallback: true,
    });
    assert.equal(r.ok, true);
    assert.ok(r.transfer?.facts);
    assert.ok(r.burn?.facts);
    assert.match(r.transfer!.replyText ?? "", /25000/);
    assert.match(r.burn!.replyText ?? "", /50000/);
    assert.ok(r.transfer!.explorerUrl);
    assert.ok(r.burn!.explorerUrl);
    assert.match(r.transfer!.idempotencyKey, /economic_followup/);
  });

  it("29–35. regression surfaces: BoS prompt has no private key; transfer adapter path untouched", () => {
    const system = buildEconomicCompletionSpeechSystemPrompt();
    assert.doesNotMatch(system, /PRIVATE_KEY|private key material/i);
    const adapter = readFileSync(
      join(process.cwd(), "src/lib/agent/transfer-effect-adapter.ts"),
      "utf8",
    );
    assert.match(adapter, /executeTransferFennViaPurse/);
    assert.match(adapter, /executeBurnFennViaPurse/);
    const exec = readFileSync(
      join(process.cwd(), "src/lib/agent/stage126-execute.ts"),
      "utf8",
    );
    assert.match(exec, /planEconomicCompletionFollowup/);
    const draft = buildEconomicFollowupDraft({
      actionType: "transfer",
      amountFormatted: "100000",
      txHash: TX,
    });
    assert.match(draft.text, /100000 FENN left my Purse/);
    assert.ok(buildEconomicCompletionFallback(factsTransfer()!));
  });
});
