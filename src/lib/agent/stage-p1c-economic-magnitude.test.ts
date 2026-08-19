/**
 * Stage P1C — economic magnitude foundation tests.
 * No blockchain broadcasts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareEconomicAmountFormatted,
  parseEconomicProposedAmount,
  PURSE_ORIGINAL_ALLOCATION_FORMATTED,
  sumEconomicAmountFormatted,
} from "@/lib/agent/economic-amount";
import {
  loadEconomicAuthorityLimits,
  PRODUCTION_HARD_MAX_SINGLE_BURN_FORMATTED,
  PRODUCTION_HARD_MAX_SINGLE_TRANSFER_FORMATTED,
  RECOMMENDED_PRODUCTION_AUTHORITY_LIMITS,
  TEST_DEFAULT_MAX_SINGLE_TRANSFER_FORMATTED,
} from "@/lib/agent/economic-authority-limits";
import { planEconomicEffects } from "@/lib/agent/economic-authority";
import {
  normalizeModelEconomicAction,
  economicIntentToJson,
} from "@/lib/agent/economic-intent";
import {
  buildEconomicFollowupDraft,
  replyClaimsCompletedEconomicAction,
} from "@/lib/agent/economic-followup";
import {
  validateBurnFennEffectPayload,
  validateTransferFennEffectPayload,
  TRANSFER_FENN_P1A_TEST_RAIL,
} from "@/lib/agent/effect-payload";
import { mapPurseOutcomeToFailureClass } from "@/lib/agent/transfer-effect-adapter";
import { evaluateP1bEconomicAuthority, harnessPurseState } from "@/lib/agent/p1b-economic-judgement-test";
import {
  ECONOMIC_CONSTITUTION_VERSION,
  buildEconomicJudgementInstructionBlock,
} from "@/lib/fenn-voice/economic-constitution";
import {
  formatPurseEconomicStateForPrompt,
} from "@/lib/agent/purse-economic-context";
import { parseVariablePurseAmount } from "@/lib/purse/policy";
import {
  executeManualOneFennTransfer,
  type ManualTransferDeps,
} from "@/lib/purse/transfer";
import type { PurseTransferRow } from "@/lib/purse/types";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { parseTokenAmountToRaw } from "@/lib/treasury/amounts";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";

const WALLET = "0xcccccccccccccccccccccccccccccccccccccccc";
const PURSE = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX =
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

function purseState(extra?: Parameters<typeof planEconomicEffects>[0]["purseState"]) {
  return {
    isEnabled: true,
    economicExecutionEnabled: true,
    environment: "p1b_test_harness" as const,
    testRailExplicitlyActive: true,
    officialFennAvailable: false,
    remainingBalanceFormatted: PURSE_ORIGINAL_ALLOCATION_FORMATTED,
    rolling24hOutflowFormatted: "0",
    tokenDecimals: 18,
    ...extra,
  };
}

describe("Stage P1C economic magnitude", () => {
  describe("schema / proposedAmount", () => {
    it("1–2. transfer and burn accept valid proposedAmount", () => {
      const t = normalizeModelEconomicAction({
        type: "transfer_fenn",
        proposedAmount: "25000",
        reason: "verified help",
        recipientSource: "trusted_profile_wallet",
      });
      assert.equal(t.type, "transfer_fenn");
      if (t.type === "transfer_fenn") {
        assert.equal(t.proposedAmount, "25000");
      }
      const b = normalizeModelEconomicAction({
        type: "burn_fenn",
        proposedAmount: "10000.5",
        reason: "rite",
      });
      assert.equal(b.type, "burn_fenn");
      if (b.type === "burn_fenn") {
        assert.equal(b.proposedAmount, "10000.5");
      }
    });

    it("3–6. zero, negative, malformed, exponent rejected", () => {
      assert.throws(() => parseEconomicProposedAmount("0"), /zero/);
      assert.throws(() => parseEconomicProposedAmount("0.0"), /zero/);
      assert.throws(() => parseEconomicProposedAmount("-1"), /negative|malformed/);
      assert.throws(() => parseEconomicProposedAmount("abc"), /malformed/);
      assert.throws(() => parseEconomicProposedAmount("1e5"), /malformed/);
      assert.throws(() => parseEconomicProposedAmount("1E3"), /malformed/);
      assert.throws(() => parseEconomicProposedAmount("NaN"), /malformed/);
      assert.throws(
        () => parseEconomicProposedAmount("1.1234567890123456789"),
        /excessive_precision/,
      );
    });

    it("7–11. model cannot control recipient/token/chain/rail/burn destination", () => {
      assert.throws(() =>
        normalizeModelEconomicAction({
          type: "transfer_fenn",
          proposedAmount: "10000",
          reason: "x",
          recipientSource: "trusted_profile_wallet",
          recipientAddress: WALLET,
        }),
      );
      assert.throws(() =>
        normalizeModelEconomicAction({
          type: "burn_fenn",
          proposedAmount: "10000",
          reason: "x",
          tokenAddress: TOKEN,
        }),
      );
      assert.throws(() =>
        normalizeModelEconomicAction({
          type: "transfer_fenn",
          proposedAmount: "10000",
          reason: "x",
          recipientSource: "trusted_profile_wallet",
          chainId: 1,
        }),
      );
      assert.throws(() =>
        normalizeModelEconomicAction({
          type: "transfer_fenn",
          proposedAmount: "10000",
          reason: "x",
          recipientSource: "trusted_profile_wallet",
          executionRail: "p1a_test",
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
  });

  describe("authority envelope", () => {
    it("12–13. exact proposed transfer and burn amounts permitted", () => {
      const x = planEconomicEffects({
        economicIntent: {
          type: "transfer_fenn",
          proposedAmount: "25000",
          reason: "recognition",
          recipientSource: "trusted_profile_wallet",
        },
        reasonCode: "answered_from_public_knowledge",
        perceptionEventId: "pe-x",
        harnessBoundWallet: WALLET,
        executionRail: "p1a_test",
        purseState: purseState(),
      });
      assert.equal(x.effects[0]?.payload.amountFormatted, "25000");

      const b = planEconomicEffects({
        economicIntent: {
          type: "burn_fenn",
          proposedAmount: "12000",
          reason: "surrender",
        },
        reasonCode: "answered_from_public_knowledge",
        perceptionEventId: "pe-b",
        executionRail: "p1a_test",
        purseState: purseState(),
      });
      assert.equal(b.effects[0]?.payload.amountFormatted, "12000");
    });

    it("14–15. transfer/burn over hard max refused (no clamp)", () => {
      const limits = loadEconomicAuthorityLimits();
      const tooMuchTransfer = sumEconomicAmountFormatted([
        limits.maxSingleTransferFormatted,
        "1",
      ]);
      const tr = planEconomicEffects({
        economicIntent: {
          type: "transfer_fenn",
          proposedAmount: tooMuchTransfer,
          reason: "too much",
          recipientSource: "trusted_profile_wallet",
        },
        reasonCode: "answered_from_public_knowledge",
        perceptionEventId: "pe-max-t",
        harnessBoundWallet: WALLET,
        executionRail: "p1a_test",
        purseState: purseState(),
        limits,
      });
      assert.equal(tr.effects.length, 0);
      assert.equal(tr.skippedReason, "amount_exceeds_transfer_limit");

      const tooMuchBurn = sumEconomicAmountFormatted([
        limits.maxSingleBurnFormatted,
        "1",
      ]);
      const br = planEconomicEffects({
        economicIntent: {
          type: "burn_fenn",
          proposedAmount: tooMuchBurn,
          reason: "too much",
        },
        reasonCode: "answered_from_public_knowledge",
        perceptionEventId: "pe-max-b",
        executionRail: "p1a_test",
        purseState: purseState(),
        limits,
      });
      assert.equal(br.effects.length, 0);
      assert.equal(br.skippedReason, "amount_exceeds_burn_limit");
    });

    it("16. rolling 24h limit enforced without clamping", () => {
      const limits = {
        maxSingleTransferFormatted: "1000000",
        maxSingleBurnFormatted: "1000000",
        maxRolling24hOutflowFormatted: "100000",
        source: "test_defaults" as const,
      };
      const r = planEconomicEffects({
        economicIntent: {
          type: "transfer_fenn",
          proposedAmount: "60000",
          reason: "after prior spend",
          recipientSource: "trusted_profile_wallet",
        },
        reasonCode: "answered_from_public_knowledge",
        perceptionEventId: "pe-24h",
        harnessBoundWallet: WALLET,
        executionRail: "p1a_test",
        purseState: purseState({ rolling24hOutflowFormatted: "50000" }),
        limits,
      });
      assert.equal(r.skippedReason, "amount_exceeds_rolling_24h_limit");
      assert.equal(r.effects.length, 0);
    });

    it("17. authority never clamps — refused amount is not rewritten downward", () => {
      const limits = {
        maxSingleTransferFormatted: "100000",
        maxSingleBurnFormatted: "50000",
        maxRolling24hOutflowFormatted: "5000000",
        source: "test_defaults" as const,
      };
      const r = planEconomicEffects({
        economicIntent: {
          type: "transfer_fenn",
          proposedAmount: "500000",
          reason: "big",
          recipientSource: "trusted_profile_wallet",
        },
        reasonCode: "answered_from_public_knowledge",
        perceptionEventId: "pe-clamp",
        harnessBoundWallet: WALLET,
        executionRail: "p1a_test",
        purseState: purseState(),
        limits,
      });
      assert.equal(r.skippedReason, "amount_exceeds_transfer_limit");
      assert.equal(r.effects.length, 0);
    });

    it("18–19. missing trusted recipient blocks; wallet alone does not create merit effects without intent", () => {
      const noWallet = planEconomicEffects({
        economicIntent: {
          type: "transfer_fenn",
          proposedAmount: "10000",
          reason: "want",
          recipientSource: "trusted_profile_wallet",
        },
        reasonCode: "answered_from_public_knowledge",
        perceptionEventId: "pe-nw",
        harnessBoundWallet: null,
        executionRail: "p1a_test",
        purseState: purseState(),
      });
      assert.equal(
      noWallet.skippedReason,
      "pending_destination",
    );

      // Wallet present but NONE intent → no effect.
      const d = evaluateP1bEconomicAuthority({
        perceptionEventId: "pe-none",
        xPostId: "9007000000000000001",
        economicIntent: { type: "NONE" },
        trustedWallet: WALLET,
      });
      assert.equal(
        d.effects.some((e) => e.type === "transfer_fenn"),
        false,
      );
    });
  });

  describe("user input / untrusted amounts", () => {
    it("20–22. requested amount does not populate effect; X amount/wallet untrusted", () => {
      // User said 100000; model chose 10000 judgement.
      const planned = planEconomicEffects({
        economicIntent: {
          type: "transfer_fenn",
          proposedAmount: "10000",
          reason: "my judgement not theirs",
          recipientSource: "trusted_profile_wallet",
        },
        reasonCode: "answered_from_public_knowledge",
        perceptionEventId: "pe-req",
        harnessBoundWallet: WALLET,
        executionRail: "p1a_test",
        purseState: purseState(),
      });
      assert.equal(planned.effects[0]?.payload.amountFormatted, "10000");
      assert.notEqual(planned.effects[0]?.payload.amountFormatted, "100000");

      // amountFormatted control field from model still forbidden
      assert.throws(() =>
        normalizeModelEconomicAction({
          type: "transfer_fenn",
          proposedAmount: "10000",
          reason: "x",
          recipientSource: "trusted_profile_wallet",
          amountFormatted: "100000",
        }),
      );
    });
  });

  describe("purse settlement", () => {
    it("23–25. exact decimal converts to raw, persists exact amount, no float", () => {
      const { amountRaw, amountFormatted } = parseVariablePurseAmount(
        "25000.5",
        18,
      );
      assert.equal(amountFormatted, "25000.5");
      assert.equal(
        amountRaw,
        parseTokenAmountToRaw("25000.5", 18),
      );
      // Compare with integer-string path — not Number()
      assert.equal(amountRaw.toString(), "25000500000000000000000");
    });

    it("26–28. retry preserves amount; mismatch fails closed; ambiguous no rebroadcast", async () => {
      const rows = new Map<string, PurseTransferRow>();
      let broadcastCount = 0;
      const amount = "777";
      const amountRaw = parseTokenAmountToRaw(amount, 18).toString();

      const deps: Partial<ManualTransferDeps> = {
        getPurse: async () => ({ walletAddress: PURSE }),
        getOfficialToken: async () => ({
          symbol: "VELL",
          name: "VELL",
          chainId: ROBINHOOD_CHAIN_ID,
          contractAddress: TOKEN,
          decimals: 18,
        }),
        acquireLock: async () => true,
        releaseLock: async () => {},
        getByOperationId: async (id) => rows.get(id) ?? null,
        insertPending: async (input) => {
          const row: PurseTransferRow = {
            id: "r1",
            operationId: input.operationId,
            recipientAddress: input.recipientAddress,
            amountRaw: input.amountRaw,
            amountFormatted: input.amountFormatted,
            tokenAddress: input.tokenAddress,
            chainId: input.chainId,
            txHash: null,
            status: "pending",
            failureClass: null,
            lastError: null,
            actorId: input.actorId,
            isTest: input.isTest,
            actionType: input.actionType,
            createdAt: "2026-08-09T00:00:00.000Z",
            submittedAt: null,
            confirmedAt: null,
          };
          rows.set(input.operationId, row);
          return row;
        },
        markSubmitted: async (input) => {
          const row = [...rows.values()].find((r) => r.id === input.id)!;
          const next = {
            ...row,
            txHash: input.txHash,
            status: "submitted" as const,
            submittedAt: input.submittedAt,
          };
          rows.set(row.operationId, next);
          return next;
        },
        markConfirmed: async (input) => {
          const row = [...rows.values()].find((r) => r.id === input.id)!;
          const next = {
            ...row,
            txHash: input.txHash,
            status: "confirmed" as const,
            confirmedAt: input.confirmedAt,
            submittedAt: input.submittedAt ?? row.submittedAt,
          };
          rows.set(row.operationId, next);
          return next;
        },
        markFailed: async (input) => {
          const row = [...rows.values()].find((r) => r.id === input.id)!;
          const next = {
            ...row,
            status: (input.status ?? "failed") as PurseTransferRow["status"],
            failureClass: input.failureClass,
            lastError: input.lastError,
            txHash: input.txHash ?? row.txHash,
          };
          rows.set(row.operationId, next);
          return next;
        },
        resetForRetry: async (id) => {
          const row = [...rows.values()].find((r) => r.id === id)!;
          const next = {
            ...row,
            status: "pending" as const,
            failureClass: null,
            lastError: null,
            txHash: null,
          };
          rows.set(row.operationId, next);
          return next;
        },
        readTokenBalance: async () => ({
          raw: parseTokenAmountToRaw("1000000", 18),
          decimals: 18,
          formatted: "1000000",
        }),
        broadcast: async () => {
          broadcastCount += 1;
          return { kind: "submitted" as const, txHash: TX };
        },
        waitReceipt: async () => ({ kind: "success" as const }),
        getReceipt: async () => ({ kind: "success" as const }),
        now: () => new Date("2026-08-09T00:00:00.000Z"),
      };

      const op = "stage12:transfer_fenn:p1c-amount-test";
      const first = await executeManualOneFennTransfer(
        {
          recipientAddress: WALLET,
          operationId: op,
          amountFormatted: amount,
        },
        deps,
      );
      assert.equal(first.ok, true);
      if (first.ok) {
        assert.equal(first.amountFormatted, amount);
      }
      assert.equal(broadcastCount, 1);
      assert.equal(rows.get(op)?.amountRaw, amountRaw);

      // Retry same amount reuses confirmation
      const second = await executeManualOneFennTransfer(
        {
          recipientAddress: WALLET,
          operationId: op,
          amountFormatted: amount,
        },
        deps,
      );
      assert.equal(second.ok, true);
      assert.equal(broadcastCount, 1);

      // Different amount fails closed
      const mismatch = await executeManualOneFennTransfer(
        {
          recipientAddress: WALLET,
          operationId: op,
          amountFormatted: "778",
        },
        deps,
      );
      assert.equal(mismatch.ok, false);
      assert.equal(broadcastCount, 1);

      // Ambiguous: no rebroadcast
      rows.set("amb-op", {
        id: "amb",
        operationId: "amb-op",
        recipientAddress: WALLET,
        amountRaw,
        amountFormatted: amount,
        tokenAddress: TOKEN,
        chainId: ROBINHOOD_CHAIN_ID,
        txHash: null,
        status: "ambiguous",
        failureClass: "ambiguous",
        lastError: "unknown",
        actorId: "t",
        isTest: false,
        actionType: "transfer",
        createdAt: "2026-08-09T00:00:00.000Z",
        submittedAt: null,
        confirmedAt: null,
      });
      const amb = await executeManualOneFennTransfer(
        {
          recipientAddress: WALLET,
          operationId: "amb-op",
          amountFormatted: amount,
        },
        deps,
      );
      assert.equal(amb.ok, false);
      if (!amb.ok) {
        assert.equal(amb.code, "purse_ambiguous");
      }
      assert.equal(mapPurseOutcomeToFailureClass("purse_ambiguous"), "ambiguous");
    });
  });

  describe("speech", () => {
    it("29–30. confirmed follow-up uses exact amount; pre-confirm cannot claim settlement", () => {
      const draft = buildEconomicFollowupDraft({
        actionType: "transfer",
        amountFormatted: "100000",
        txHash: TX,
      });
      assert.match(draft.text, /100000 VELL left my Purse/);
      assert.equal(
        replyClaimsCompletedEconomicAction("I may send FENN if permitted."),
        false,
      );
    });
  });

  describe("regression", () => {
    it("31. NONE still works", () => {
      const r = planEconomicEffects({
        economicIntent: { type: "NONE" },
        reasonCode: "answered_from_public_knowledge",
        perceptionEventId: "pe-none",
        executionRail: "p1a_test",
        purseState: purseState(),
      });
      assert.equal(r.effects.length, 0);
      assert.equal(r.skippedReason, "none");
    });

    it("32–36. action types, commons string amounts, constitution scale, production limits", () => {
      assert.equal(
        ECONOMIC_CONSTITUTION_VERSION,
        "purse-economic-constitution-v1.5",
      );
      const block = buildEconomicJudgementInstructionBlock();
      assert.match(block, /proposedAmount/);
      assert.match(block, /10,000 VELL and 500,000 VELL/);
      assert.match(block, /does not set your economic action/i);

      const state = harnessPurseState();
      const prompt = formatPurseEconomicStateForPrompt(state);
      assert.match(prompt, /10000000/);
      assert.match(prompt, /0\.1% of original/);
      assert.match(prompt, /TEST RAIL/);

      // P2B: production defaults = launch hard ceilings
      assert.equal(
        PRODUCTION_HARD_MAX_SINGLE_TRANSFER_FORMATTED,
        loadEconomicAuthorityLimits({}).maxSingleTransferFormatted,
      );
      assert.equal(
        loadEconomicAuthorityLimits({}).maxSingleBurnFormatted,
        PRODUCTION_HARD_MAX_SINGLE_BURN_FORMATTED,
      );
      // Explicit test profile keeps wider harness envelope
      assert.equal(
        TEST_DEFAULT_MAX_SINGLE_TRANSFER_FORMATTED,
        loadEconomicAuthorityLimits({
          FENN_PURSE_AUTHORITY_LIMITS_PROFILE: "test",
        }).maxSingleTransferFormatted,
      );
      assert.ok(
        compareEconomicAmountFormatted(
          PRODUCTION_HARD_MAX_SINGLE_BURN_FORMATTED,
          PRODUCTION_HARD_MAX_SINGLE_TRANSFER_FORMATTED,
        ) < 0,
      );
      assert.equal(
        RECOMMENDED_PRODUCTION_AUTHORITY_LIMITS.maxSingleTransferFormatted,
        "100000",
      );

      // Effect validate still accepts amount "1" (historical / P0).
      const ok = validateTransferFennEffectPayload({
        recipientAddress: WALLET,
        amountFormatted: "1",
        executionRail: TRANSFER_FENN_P1A_TEST_RAIL,
      });
      assert.equal(ok.amountFormatted, "1");
      const burn = validateBurnFennEffectPayload({
        amountFormatted: "1",
        executionRail: TRANSFER_FENN_P1A_TEST_RAIL,
      });
      assert.equal(burn.amountFormatted, "1");

      const json = economicIntentToJson({
        type: "burn_fenn",
        proposedAmount: "1",
        reason: "legacy unit",
      });
      assert.equal(json.proposedAmount, "1");
    });
  });
});
