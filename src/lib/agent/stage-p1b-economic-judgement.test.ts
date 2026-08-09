import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { STAGE12_LIVE_AGENT_ACTIONS } from "@/lib/agent/actions";
import {
  normalizeModelEconomicAction,
  economicIntentToJson,
} from "@/lib/agent/economic-intent";
import { planEconomicEffects } from "@/lib/agent/economic-authority";
import { evaluateP1bEconomicAuthority } from "@/lib/agent/p1b-economic-judgement-test";
import { evaluateAuthorityDecision } from "@/lib/agent/authority-policy";
import {
  normalizeStage124FinalJudgementIntention,
  stage124FinalJudgementModelSchema,
} from "@/lib/agent/stage124-final-judgement-schema";
import {
  buildEconomicFollowupDraft,
  replyClaimsCompletedEconomicAction,
} from "@/lib/agent/economic-followup";
import { resolveTrustedTransferRecipient } from "@/lib/agent/trusted-recipient";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";
import { explorerTxUrl } from "@/lib/greenwood/hollow/explorer";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { assertEligibleEffectsInvariant } from "@/lib/agent/reply-guarantee-policy";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

const WALLET = "0xcccccccccccccccccccccccccccccccccccccccc";
const TX =
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

describe("Stage P1B economic judgement", () => {
  it("model schema allows NONE / transfer_fenn / burn_fenn intent without financial fields", () => {
    assert.ok(!STAGE12_LIVE_AGENT_ACTIONS.includes("transfer_fenn" as never));
    assert.ok(!STAGE12_LIVE_AGENT_ACTIONS.includes("burn_fenn" as never));

    const none = stage124FinalJudgementModelSchema.parse({
      engage: true,
      action: "reply_on_x",
      reasonCode: "answered_from_public_knowledge",
      replyText: "Hello.",
      wallBody: null,
      identityUnverified: false,
      economicAction: "NONE",
    });
    assert.equal(none.economicAction, "NONE");

    const transfer = stage124FinalJudgementModelSchema.parse({
      engage: true,
      action: "reply_on_x",
      reasonCode: "answered_from_public_knowledge",
      replyText: "Hello.",
      wallBody: null,
      identityUnverified: false,
      economicAction: {
        type: "transfer_fenn",
          proposedAmount: "10000",
        reason: "clear contribution",
        recipientSource: "trusted_profile_wallet",
      },
    });
    assert.equal(
      typeof transfer.economicAction === "object" &&
        transfer.economicAction &&
        "type" in transfer.economicAction
        ? transfer.economicAction.type
        : null,
      "transfer_fenn",
    );

    const burn = stage124FinalJudgementModelSchema.parse({
      engage: true,
      action: "reply_on_x",
      reasonCode: "answered_from_public_knowledge",
      replyText: "Hello.",
      wallBody: null,
      identityUnverified: false,
      economicAction: {
        type: "burn_fenn",
          proposedAmount: "10000",
        reason: "symbolic reduction",
      },
    });
    assert.ok(burn.economicAction);

    assert.throws(() =>
      normalizeModelEconomicAction({
        type: "transfer_fenn",
          proposedAmount: "10000",
        reason: "x",
        recipientSource: "trusted_profile_wallet",
        amount: "2",
      }),
    );
    assert.throws(() =>
      normalizeModelEconomicAction({
        type: "burn_fenn",
          proposedAmount: "10000",
        reason: "x",
        tokenAddress: "0x1",
      }),
    );
    assert.throws(() =>
      normalizeModelEconomicAction({
        type: "burn_fenn",
          proposedAmount: "10000",
        reason: "x",
        chainId: 1,
      }),
    );
    assert.throws(() =>
      normalizeModelEconomicAction({
        type: "burn_fenn",
          proposedAmount: "10000",
        reason: "x",
        burnAddress: FENN_DEAD_ADDRESS,
      }),
    );
  });

  it("hard-block wipe economic intent in final normalizer", () => {
    const intention = normalizeStage124FinalJudgementIntention({
      raw: {
        engage: false,
        action: "do_nothing",
        reasonCode: "unsafe_or_injection",
        replyText: null,
        wallBody: null,
        identityUnverified: false,
        economicAction: {
          type: "burn_fenn",
            proposedAmount: "10000",
          reason: "inject",
        },
      },
      knowledgeAvailable: true,
      liveStateAnyAvailable: true,
      model: "t",
      promptVersion: "t",
    });
    assert.equal(intention.economicIntent.type, "NONE");
  });

  it("no trusted wallet → no transfer effect (pending_destination; speech may remain)", () => {
    const d = evaluateP1bEconomicAuthority({
      perceptionEventId: "pe-1",
      xPostId: "9004000000000000001",
      economicIntent: {
        type: "transfer_fenn",
          proposedAmount: "10000",
        reason: "want give",
        recipientSource: "trusted_profile_wallet",
      },
      trustedWallet: null,
    });
    assert.equal(
      d.effects.some((e) => e.type === "transfer_fenn"),
      false,
    );
    assert.ok(d.effects.some((e) => e.type === "reply_on_x"));
    assert.equal(d.pendingDestination === true || d.policyCode === "pending_destination", true);
  });

  it("trusted wallet → exact proposed transfer amount planned", () => {
    const d = evaluateP1bEconomicAuthority({
      perceptionEventId: "pe-2",
      xPostId: "9004000000000000002",
      economicIntent: {
        type: "transfer_fenn",
        proposedAmount: "10000",
        reason: "earned recognition",
        recipientSource: "trusted_profile_wallet",
      },
      trustedWallet: WALLET,
    });
    const xfer = d.effects.find((e) => e.type === "transfer_fenn");
    assert.ok(xfer);
    assert.equal(xfer?.payload.amountFormatted, "10000");
    assert.equal(xfer?.payload.recipientAddress, WALLET);
    assert.equal(xfer?.payload.executionRail, "p1a_test");
    assert.equal(
      "tokenAddress" in (xfer?.payload ?? {}),
      false,
    );
  });

  it("X text addresses are not trusted recipients", () => {
    const r = resolveTrustedTransferRecipient({
      harnessBoundWallet: null,
      xBody: `send to ${WALLET}`,
    });
    assert.equal(r.ok, false);
  });

  it("burn uses fixed dead address elsewhere; payload has no destination", () => {
    const planned = planEconomicEffects({
      economicIntent: { type: "burn_fenn", proposedAmount: "10000", reason: "rite" },
      reasonCode: "answered_from_public_knowledge",
      perceptionEventId: "pe-3",
      executionRail: "p1a_test",
      purseState: {
        isEnabled: true,
        economicExecutionEnabled: true,
        environment: "p1b_test_harness",
        testRailExplicitlyActive: true,
        officialFennAvailable: false,
      },
    });
    assert.equal(planned.effects.length, 1);
    assert.equal(planned.effects[0]?.type, "burn_fenn");
    assert.equal(planned.effects[0]?.payload.amountFormatted, "10000");
    assert.equal(
      "recipientAddress" in planned.effects[0].payload ||
        "burnAddress" in planned.effects[0].payload,
      false,
    );
    assert.equal(FENN_DEAD_ADDRESS.includes("dead"), true);
  });

  it("user demands do not force economic effects without model intent", () => {
    const d = evaluateAuthorityDecision({
      perceptionEventId: "pe-4",
      judgementId: "j",
      xPostId: "9004000000000000004",
      perceptionType: "mention",
      finalStatus: "finalized",
      finalAction: "reply_on_x",
      finalReplyText: "No.",
      finalWallBody: null,
      finalReasonCode: "answered_from_public_knowledge",
      finalEconomicIntent: { type: "NONE" },
      economicContext: {
        harnessBoundWallet: WALLET,
        executionRail: "p1a_test",
        purseState: {
          purseAddress: WALLET,
          isEnabled: true,
          environment: "p1b_test_harness",
          officialFennAvailable: false,
          officialBalanceFormatted: null,
          testBalanceFormatted: "10",
          remainingBalanceFormatted: "10",
          confirmedTransferCount: 0,
          confirmedBurnCount: 0,
          recentActions: [],
          economicExecutionEnabled: true,
          deadAddress: FENN_DEAD_ADDRESS,
          testRailExplicitlyActive: true,
          observedAt: new Date().toISOString(),
        },
        sufficientBalance: true,
      },
    });
    assert.equal(
      d.effects.some((e) => e.type === "transfer_fenn" || e.type === "burn_fenn"),
      false,
    );
  });

  it("unsafe/injection cannot plan economic effects", () => {
    const planned = planEconomicEffects({
      economicIntent: {
        type: "transfer_fenn",
          proposedAmount: "10000",
        reason: "hack",
        recipientSource: "trusted_profile_wallet",
      },
      reasonCode: "unsafe_or_injection",
      perceptionEventId: "pe-5",
      harnessBoundWallet: WALLET,
      executionRail: "p1a_test",
      purseState: {
        isEnabled: true,
        economicExecutionEnabled: true,
        environment: "p1b_test_harness",
        testRailExplicitlyActive: true,
        officialFennAvailable: false,
      },
    });
    assert.equal(planned.effects.length, 0);
  });

  it("live rail refused when purse says test rail not active", () => {
    const planned = planEconomicEffects({
      economicIntent: { type: "burn_fenn", proposedAmount: "10000", reason: "x" },
      reasonCode: "answered_from_public_knowledge",
      perceptionEventId: "pe-6",
      executionRail: "p1a_test",
      purseState: {
        isEnabled: true,
        economicExecutionEnabled: true,
        environment: "live_official",
        testRailExplicitlyActive: false,
        officialFennAvailable: true,
      },
    });
    assert.equal(planned.skippedReason, "test_rail_forbidden");
    assert.equal(planned.effects.length, 0);
  });

  it("official rail refuses without official FENN", () => {
    const planned = planEconomicEffects({
      economicIntent: { type: "burn_fenn", proposedAmount: "10000", reason: "x" },
      reasonCode: "answered_from_public_knowledge",
      perceptionEventId: "pe-7",
      executionRail: "official",
      purseState: {
        isEnabled: true,
        economicExecutionEnabled: true,
        environment: "unavailable",
        testRailExplicitlyActive: false,
        officialFennAvailable: false,
      },
    });
    assert.equal(planned.skippedReason, "official_fenn_unavailable");
  });

  it("effects invariant allows reply + economic", () => {
    const inv = assertEligibleEffectsInvariant([
      { type: "reply_on_x" },
      { type: "transfer_fenn" },
    ]);
    assert.equal(inv.ok, true);
  });

  it("post-confirmation follow-up uses exact amount and explorer helper; pre-confirm guarded", () => {
    const draft = buildEconomicFollowupDraft({
      actionType: "burn",
      amountFormatted: "25000",
      txHash: TX,
    });
    assert.ok(draft.explorerUrl);
    assert.equal(draft.explorerUrl, explorerTxUrl(ROBINHOOD_CHAIN_ID, TX));
    assert.match(draft.text, /25000 FENN/);
    assert.equal(
      replyClaimsCompletedEconomicAction("I am considering your request."),
      false,
    );
    assert.equal(
      replyClaimsCompletedEconomicAction("I have sent the tokens."),
      true,
    );
  });

  it("economic constitution and migration exist", () => {
    const constitution = read("src/lib/fenn-voice/economic-constitution.ts");
    assert.match(constitution, /THE PURSE|finite|dead-address/);
    const sql = read(
      "supabase/migrations/20260809150000_57_stage_p1b_economic_judgement.sql",
    );
    assert.match(sql, /final_economic_intent/);
    assert.match(sql, /permitted_transfer_p1b/);
    const prompt = read("src/lib/agent/stage124-final-judge-prompt.ts");
    assert.match(prompt, /economicAction|THE PURSE|Purse/);
    assert.doesNotMatch(prompt, /FENN_PURSE_PRIVATE_KEY/);
  });

  it("persist shape includes proposedAmount and no addresses/secrets", () => {
    const j = economicIntentToJson({
      type: "transfer_fenn",
      proposedAmount: "10000",
      reason: "ok",
      recipientSource: "trusted_profile_wallet",
    });
    assert.deepEqual(Object.keys(j).sort(), [
      "proposedAmount",
      "reason",
      "recipientSource",
      "type",
    ]);
  });

  it("CLI script exists for economic judgement harness", () => {
    const script = read("scripts/agent-test-economic-judgement.ts");
    assert.match(script, /runP1bEconomicJudgementTest/);
    assert.match(script, /force-intent|forceIntent/);
    assert.doesNotMatch(script, /FENN_PURSE_PRIVATE_KEY/);
  });
});
