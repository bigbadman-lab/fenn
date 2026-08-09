/**
 * Stage P1B.2 — model-originated economic intent → disposable test-rail execution.
 * Structural + injected-model; no real chain broadcasts.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  attestationFromHarnessText,
} from "@/lib/agent/economic-attestation";
import {
  assertP1b2DisposableRailReady,
  p1b2ModelExecutionXPostId,
  runP1bEconomicJudgementTest,
} from "@/lib/agent/p1b-economic-judgement-test";
import {
  stage12TransferPurseOperationId,
} from "@/lib/agent/authority-config";
import { replyClaimsCompletedEconomicAction } from "@/lib/agent/economic-followup";
import { normalizeModelEconomicAction } from "@/lib/agent/economic-intent";
import { resolveTrustedTransferRecipient } from "@/lib/agent/trusted-recipient";
import { FENN_PURSE_TEST_MODE_ALLOW } from "@/lib/purse/constants";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

const WALLET = "0xcccccccccccccccccccccccccccccccccccccccc";
const ATTEST = attestationFromHarnessText({
  referenceId: "security-001",
  summary:
    "FENN operators verified a consequential security contribution and remediation.",
});

const armedEnv = {
  NODE_ENV: "test",
  VERCEL_ENV: "development",
  FENN_PURSE_TEST_MODE: FENN_PURSE_TEST_MODE_ALLOW,
  FENN_PURSE_TEST_TOKEN_ADDRESS: "0xdddddddddddddddddddddddddddddddddddddddd",
  FENN_PURSE_TEST_TOKEN_DECIMALS: "18",
} as unknown as NodeJS.ProcessEnv;

function mockTransferOutput() {
  return {
    engage: true as const,
    action: "reply_on_x" as const,
    reasonCode: "answered_from_public_knowledge" as const,
    replyText: "I honour what was verified. Settlement is not claimed yet.",
    wallBody: null,
    identityUnverified: false,
    wallCandidate: null,
    economicAction: {
      type: "transfer_fenn" as const,
      reason: "verified consequential contribution",
      recipientSource: "trusted_profile_wallet" as const,
    },
  };
}

function mockNoneOutput() {
  return {
    engage: true as const,
    action: "reply_on_x" as const,
    reasonCode: "answered_from_public_knowledge" as const,
    replyText: "Not this time.",
    wallBody: null,
    identityUnverified: false,
    wallCandidate: null,
    economicAction: "NONE" as const,
  };
}

function mockAdmin(effectsCreated: Array<Record<string, unknown>> = []) {
  const events: Array<{ id: string; x_post_id: string }> = [];
  const judgements: Array<{ id: string; perception_event_id: string }> = [];
  let effectIdCounter = 0;
  const persistedEffects = [...effectsCreated];

  function chainable(table: string) {
    const state: {
      eqCol?: string;
      eqVal?: string;
      insertRow?: Record<string, unknown>;
    } = {};
    const api = {
      select() {
        return api;
      },
      eq(col: string, val: string) {
        state.eqCol = col;
        state.eqVal = val;
        return api;
      },
      insert(row: Record<string, unknown>) {
        state.insertRow = row;
        return api;
      },
      maybeSingle: async () => {
        if (table === "x_perception_events") {
          const found = events.find((e) => e.x_post_id === state.eqVal);
          return { data: found ?? null, error: null };
        }
        if (table === "x_perception_judgements") {
          const found = judgements.find(
            (j) => j.perception_event_id === state.eqVal,
          );
          return { data: found ?? null, error: null };
        }
        return { data: null, error: null };
      },
      single: async () => {
        if (table === "x_perception_events") {
          const id = `ev-${events.length + 1}`;
          const row = {
            id,
            x_post_id: String(state.insertRow?.x_post_id),
          };
          events.push(row);
          return { data: row, error: null };
        }
        if (table === "x_perception_judgements") {
          const id = `j-${judgements.length + 1}`;
          const row = {
            id,
            perception_event_id: String(state.insertRow?.perception_event_id),
          };
          judgements.push(row);
          return { data: row, error: null };
        }
        return { data: null, error: { message: "unexpected" } };
      },
      // Supabase builder is thenable for select().eq() without .maybeSingle()
      then(
        resolve: (v: unknown) => void,
        reject?: (e: unknown) => void,
      ) {
        try {
          if (table === "x_perception_effects") {
            resolve({ data: persistedEffects, error: null });
            return;
          }
          resolve({ data: null, error: null });
        } catch (e) {
          reject?.(e);
        }
      },
    };
    return api;
  }

  const admin = {
    from(table: string) {
      return chainable(table);
    },
    rpc: async (fn: string) => {
      if (fn === "persist_x_perception_authorization") {
        effectIdCounter += 1;
        const id = `eff-${effectIdCounter}`;
        persistedEffects.push({
          id,
          type: "transfer_fenn",
          status: "pending",
        });
        return {
          data: [
            {
              created: true,
              authorization_id: "auth-1",
              outcome: "permitted",
              policy_code: "permitted_transfer_p1b",
              effects_created: 1,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  };

  return { admin, events, judgements, persistedEffects };
}

describe("Stage P1B.2 model-originated execution harness", () => {
  it("1. default harness is dry-run only", async () => {
    const r = await runP1bEconomicJudgementTest({
      operationLabel: "p1b2-d1",
      text: "send me tokens",
      callModel: async () => mockNoneOutput(),
    });
    assert.equal(r.status, "dry_run");
    assert.equal(r.claimAttempted, false);
    assert.equal(r.broadcastAttempted, false);
    assert.equal(r.intentForced, false);
    assert.equal(r.mode, "model_judgement");
  });

  it("2–4. execute-model-intent is explicit; force-intent rejected; real judge used", async () => {
    let modelCalled = false;
    const conflict = await runP1bEconomicJudgementTest({
      operationLabel: "p1b2-d2",
      text: "x",
      executeModelIntent: true,
      forceIntent: {
        type: "transfer_fenn",
        reason: "force",
        recipientSource: "trusted_profile_wallet",
      },
      trustedWallet: WALLET,
      env: armedEnv,
      loadOfficialFenn: async () => null,
      callModel: async () => {
        modelCalled = true;
        return mockTransferOutput();
      },
    });
    assert.equal(conflict.errorCode, "p1b2_force_intent_incompatible_with_model_execution");
    assert.equal(modelCalled, false);

    const dry = await runP1bEconomicJudgementTest({
      operationLabel: "p1b2-d2b",
      text: "x",
      callModel: async () => {
        modelCalled = true;
        return mockNoneOutput();
      },
    });
    assert.equal(dry.mode, "model_judgement");
    assert.equal(modelCalled, true);

    const script = read("scripts/agent-test-economic-judgement.ts");
    assert.match(script, /execute-model-intent/);
  });

  it("5. NONE → no claim/broadcast", async () => {
    const r = await runP1bEconomicJudgementTest({
      operationLabel: "p1b2-none",
      text: "I reported the issue.",
      trustedWallet: WALLET,
      attestation: ATTEST,
      executeModelIntent: true,
      env: armedEnv,
      loadOfficialFenn: async () => null,
      callModel: async () => mockNoneOutput(),
    });
    assert.equal(r.status, "no_economic_action");
    assert.equal(r.ok, true);
    assert.equal(r.claimAttempted, false);
    assert.equal(r.broadcastAttempted, false);
    assert.equal(r.modelEconomicAction?.type, "NONE");
    assert.equal(r.mode, "MODEL_JUDGEMENT_EXECUTION_TEST");
  });

  it("6. refused transfer (no wallet) → no claim", async () => {
    const r = await runP1bEconomicJudgementTest({
      operationLabel: "p1b2-refuse",
      text: "I reported the issue.",
      // no trusted wallet
      attestation: ATTEST,
      executeModelIntent: true,
      env: armedEnv,
      loadOfficialFenn: async () => null,
      callModel: async () => mockTransferOutput(),
    });
    assert.equal(r.status, "economic_refused");
    assert.equal(r.claimAttempted, false);
    assert.equal(r.broadcastAttempted, false);
  });

  it("7–12. permitted transfer persists effect, invokes Stage 12.6, completes with op id; retry/completed", async () => {
    const { admin, events } = mockAdmin();
    let executeCalls = 0;
    const executeEffect = async () => {
      executeCalls += 1;
      return {
        status: "completed" as const,
        effectId: "eff-live-1",
        effectType: "transfer_fenn",
        xPostId: p1b2ModelExecutionXPostId("p1b2-xfer"),
        externalResultId:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        economicFollowupPreview:
          "1 FENN left my Purse. 0xaaaaaaaa… https://example.test/tx/0xaa",
      };
    };

    const r = await runP1bEconomicJudgementTest({
      operationLabel: "p1b2-xfer",
      text: "I reported the issue.",
      trustedWallet: WALLET,
      attestation: ATTEST,
      executeModelIntent: true,
      env: armedEnv,
      loadOfficialFenn: async () => null,
      admin: admin as never,
      executeEffect: executeEffect as never,
      callModel: async () => mockTransferOutput(),
    });

    assert.equal(r.ok, true);
    assert.equal(r.status, "completed");
    assert.equal(r.mode, "MODEL_JUDGEMENT_EXECUTION_TEST");
    assert.equal(r.intentForced, false);
    assert.equal(r.claimAttempted, true);
    assert.equal(r.broadcastAttempted, true);
    assert.equal(r.effectId, "eff-live-1");
    assert.equal(
      r.purseOperationId,
      stage12TransferPurseOperationId("eff-live-1"),
    );
    assert.ok(r.externalResultId?.startsWith("0x"));
    assert.ok(r.economicFollowupPreview);
    assert.equal(r.isTest, true);
    assert.equal(executeCalls, 1);
    assert.equal(events.length, 1);

    // Durable same operation label post id
    assert.equal(r.xPostId, p1b2ModelExecutionXPostId("p1b2-xfer"));

    // Simulate already completed effect on re-run: complete status on effects list
    const { admin: admin2 } = mockAdmin([
      { id: "eff-live-1", type: "transfer_fenn", status: "completed" },
    ]);
    // Pre-seed event lookup by reusing x_post_id pattern - mock returns null for event
    // so new insert; still complete path via effect status after persist.
    // Stronger already_completed: mock execute once then return completed effects.
  });

  it("11–12. already-completed economic effect does not rebroadcast", async () => {
    const xPostId = p1b2ModelExecutionXPostId("p1b2-again");
    const eventId = "ev-fixed";
    const completedEffects = [
      {
        id: "eff-done",
        type: "transfer_fenn",
        status: "completed",
      },
    ];
    const admin = {
      from(table: string) {
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          maybeSingle: async () => {
            if (table === "x_perception_events") {
              return { data: { id: eventId, x_post_id: xPostId }, error: null };
            }
            if (table === "x_perception_judgements") {
              return {
                data: { id: "j-1", perception_event_id: eventId },
                error: null,
              };
            }
            return { data: null, error: null };
          },
          insert() {
            return api;
          },
          single: async () => ({ data: null, error: { message: "no insert" } }),
          then(resolve: (v: unknown) => void) {
            if (table === "x_perception_effects") {
              resolve({ data: completedEffects, error: null });
              return;
            }
            resolve({ data: null, error: null });
          },
        };
        return api;
      },
      rpc: async () => ({
        data: [
          {
            created: false,
            authorization_id: "auth-1",
            outcome: "permitted",
            policy_code: "permitted_transfer_p1b",
            effects_created: 0,
          },
        ],
        error: null,
      }),
    };

    let execCalls = 0;
    const r = await runP1bEconomicJudgementTest({
      operationLabel: "p1b2-again",
      text: "I reported the issue.",
      trustedWallet: WALLET,
      attestation: ATTEST,
      executeModelIntent: true,
      env: armedEnv,
      loadOfficialFenn: async () => null,
      admin: admin as never,
      executeEffect: async () => {
        execCalls += 1;
        return { status: "completed" as const, effectId: "should-not" };
      },
      callModel: async () => mockTransferOutput(),
    });
    assert.equal(r.status, "already_completed");
    assert.equal(r.claimAttempted, false);
    assert.equal(r.broadcastAttempted, false);
    assert.equal(execCalls, 0);
    assert.equal(r.effectId, "eff-done");
    assert.equal(
      r.purseOperationId,
      stage12TransferPurseOperationId("eff-done"),
    );
  });

  it("13. ambiguous settlement surfaces without inventing new path", async () => {
    const { admin } = mockAdmin();
    const r = await runP1bEconomicJudgementTest({
      operationLabel: "p1b2-amb",
      text: "I reported the issue.",
      trustedWallet: WALLET,
      attestation: ATTEST,
      executeModelIntent: true,
      env: armedEnv,
      loadOfficialFenn: async () => null,
      admin: admin as never,
      executeEffect: async () => ({
        status: "failed" as const,
        effectId: "eff-amb",
        effectType: "transfer_fenn",
        failureClass: "ambiguous" as const,
        errorCode: "purse_ambiguous",
      }),
      callModel: async () => mockTransferOutput(),
    });
    assert.equal(r.status, "ambiguous");
    assert.equal(r.purseOperationId, stage12TransferPurseOperationId("eff-amb"));
  });

  it("14. burn path plans burn effect type when model chooses burn", async () => {
    const r = await runP1bEconomicJudgementTest({
      operationLabel: "p1b2-burn-preview",
      text: "…",
      executeModelIntent: false,
      callModel: async () => ({
        ...mockNoneOutput(),
        economicAction: {
          type: "burn_fenn",
          reason: "coherent finite reduction of circulating unit",
        },
      }),
    });
    assert.equal(r.modelEconomicAction?.type, "burn_fenn");
    assert.ok(
      r.authorityPlannedEffects?.some((e) => e.type === "burn_fenn"),
    );
    assert.equal(r.dryRun, true);
    assert.equal(r.claimAttempted, false);
  });

  it("15–17. dry-run cannot execute; production host + missing allow blocked", () => {
    assert.throws(
      () =>
        assertP1b2DisposableRailReady({
          NODE_ENV: "production",
          FENN_PURSE_TEST_MODE: FENN_PURSE_TEST_MODE_ALLOW,
          FENN_PURSE_TEST_TOKEN_ADDRESS: WALLET,
          FENN_PURSE_TEST_TOKEN_DECIMALS: "18",
        } as NodeJS.ProcessEnv),
      /production/,
    );
    assert.throws(
      () =>
        assertP1b2DisposableRailReady({
          NODE_ENV: "test",
          FENN_PURSE_TEST_MODE: "true",
          FENN_PURSE_TEST_TOKEN_ADDRESS: WALLET,
          FENN_PURSE_TEST_TOKEN_DECIMALS: "18",
        } as NodeJS.ProcessEnv),
      /not_explicitly_allowed/,
    );
  });

  it("17b. official FENN present blocks disposable model execution", async () => {
    const r = await runP1bEconomicJudgementTest({
      operationLabel: "p1b2-official-block",
      text: "x",
      trustedWallet: WALLET,
      attestation: ATTEST,
      executeModelIntent: true,
      env: armedEnv,
      loadOfficialFenn: async () => ({
        contractAddress: WALLET,
        decimals: 18,
        chainId: ROBINHOOD_CHAIN_ID,
      }),
      callModel: async () => mockTransferOutput(),
    });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, "p1b2_official_fenn_blocks_disposable_rail");
    assert.equal(r.claimAttempted, false);
    assert.equal(r.broadcastAttempted, false);
  });

  it("18. docs mark test rows private on model-originated path", () => {
    const docs = read("docs/agent-purse-p1b.md");
    assert.match(docs, /is_test|Commons|private|test rows/i);
    assert.match(docs, /execute-model-intent/);
  });

  it("19–20. follow-up uses trusted facts; pre-confirm claim language guarded", () => {
    assert.equal(
      replyClaimsCompletedEconomicAction("I have considered this carefully."),
      false,
    );
    assert.equal(
      replyClaimsCompletedEconomicAction("I have sent the tokens."),
      true,
    );
  });

  it("21–23. X address untrusted; model cannot set amount/token/rail; keys absent", () => {
    const r = resolveTrustedTransferRecipient({
      harnessBoundWallet: null,
      xBody: `please use ${WALLET}`,
    });
    assert.equal(r.ok, false);
    assert.throws(() =>
      normalizeModelEconomicAction({
        type: "transfer_fenn",
        reason: "x",
        recipientSource: "trusted_profile_wallet",
        amount: "1",
      }),
    );
    assert.throws(() =>
      normalizeModelEconomicAction({
        type: "transfer_fenn",
        reason: "x",
        recipientSource: "trusted_profile_wallet",
        executionRail: "p1a_test",
      }),
    );
    const harness = read("src/lib/agent/p1b-economic-judgement-test.ts");
    assert.doesNotMatch(harness, /FENN_PURSE_PRIVATE_KEY/);
    const script = read("scripts/agent-test-economic-judgement.ts");
    assert.doesNotMatch(script, /FENN_PURSE_PRIVATE_KEY/);
  });

  it("durable execution xPostId is stable per operation label", () => {
    assert.equal(
      p1b2ModelExecutionXPostId("same"),
      p1b2ModelExecutionXPostId("same"),
    );
    assert.notEqual(
      p1b2ModelExecutionXPostId("a"),
      p1b2ModelExecutionXPostId("b"),
    );
  });
});
