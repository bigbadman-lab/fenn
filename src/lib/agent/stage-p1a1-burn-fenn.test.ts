import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  STAGE125_EFFECT_TYPES,
  stage12BurnFennEffectIdempotencyKey,
  stage12BurnPurseOperationId,
  stage12TransferPurseOperationId,
} from "@/lib/agent/authority-config";
import {
  TRANSFER_FENN_P1A_TEST_RAIL,
  validateBurnFennEffectPayload,
} from "@/lib/agent/effect-payload";
import {
  executeBurnFennViaPurse,
  mapPurseOutcomeToFailureClass,
} from "@/lib/agent/transfer-effect-adapter";
import { executeOneXPerceptionEffect } from "@/lib/agent/stage126-execute";
import { STAGE12_LIVE_AGENT_ACTIONS } from "@/lib/agent/actions";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";
import { parseEvmAddress } from "@/lib/wallet/evm";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

const TX =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("Stage P1A.1 burn_fenn effect contract", () => {
  it("includes burn_fenn as a Stage 12 effect type", () => {
    assert.ok(STAGE125_EFFECT_TYPES.includes("burn_fenn"));
    const sql = read(
      "supabase/migrations/20260809140000_56_stage_p1a1_burn_fenn.sql",
    );
    assert.match(sql, /burn_fenn/);
    assert.match(sql, /permitted_burn_p1a/);
    assert.match(sql, /action_type/);
  });

  it("ordinary live judgement cannot generate burn_fenn", () => {
    assert.ok(!STAGE12_LIVE_AGENT_ACTIONS.includes("burn_fenn" as never));
    const schema = read("src/lib/agent/stage124-final-judgement-schema.ts");
    assert.match(schema, /economicAction/);
    assert.doesNotMatch(schema, /action:\s*z\.enum.*burn_fenn/);
    const policy = read("src/lib/agent/authority-policy.ts");
    assert.match(policy, /planEconomicEffects|appendEconomicEffects/);
  });

  it("validates fixed amount and rejects recipient/token/chain overrides", () => {
    const ok = validateBurnFennEffectPayload({
      amountFormatted: "1",
      executionRail: TRANSFER_FENN_P1A_TEST_RAIL,
    });
    assert.equal(ok.amountFormatted, "1");
    assert.equal(ok.executionRail, "p1a_test");

    assert.throws(
      () =>
        validateBurnFennEffectPayload({
          amountFormatted: "1",
          recipientAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
        }),
      /burn_recipient_forbidden/,
    );
    assert.throws(
      () =>
        validateBurnFennEffectPayload({
          amountFormatted: "2",
        }),
      /burn_amount_not_fixed/,
    );
    assert.throws(
      () =>
        validateBurnFennEffectPayload({
          amountFormatted: "1",
          tokenAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
        }),
      /burn_token_forbidden/,
    );
    assert.throws(
      () =>
        validateBurnFennEffectPayload({
          amountFormatted: "1",
          chainId: ROBINHOOD_CHAIN_ID,
        }),
      /burn_chain_forbidden/,
    );
    assert.throws(
      () =>
        validateBurnFennEffectPayload({
          amountFormatted: "1",
          burnAddress: FENN_DEAD_ADDRESS,
        }),
      /burn_address_override_forbidden/,
    );
    assert.throws(
      () =>
        validateBurnFennEffectPayload({
          amountFormatted: "1",
          calldata: "0xdead",
        }),
      /burn_calldata_forbidden/,
    );
  });

  it("uses the canonical dead address (normalized lowercase)", () => {
    assert.equal(
      parseEvmAddress("0x000000000000000000000000000000000000dEaD"),
      FENN_DEAD_ADDRESS,
    );
    assert.equal(
      FENN_DEAD_ADDRESS,
      "0x000000000000000000000000000000000000dead",
    );
  });

  it("derives deterministic burn Purse operation_id distinct from transfer", () => {
    const a = stage12BurnPurseOperationId("effect-uuid-1");
    const b = stage12BurnPurseOperationId("effect-uuid-1");
    assert.equal(a, b);
    assert.equal(a, "stage12:burn_fenn:effect-uuid-1");
    assert.notEqual(
      stage12BurnPurseOperationId("effect-uuid-1"),
      stage12TransferPurseOperationId("effect-uuid-1"),
    );
    assert.equal(
      stage12BurnFennEffectIdempotencyKey("p1a-burn-001"),
      "p1a:burn_fenn:p1a-burn-001",
    );
  });

  it("maps Purse outcomes to Stage 12 failure classes for burns", () => {
    assert.equal(mapPurseOutcomeToFailureClass("purse_ambiguous"), "ambiguous");
    assert.equal(mapPurseOutcomeToFailureClass("purse_lock_busy"), "retryable");
    assert.equal(mapPurseOutcomeToFailureClass("purse_terminal_failed"), "terminal");
  });

  it("burn adapter is idempotent on confirmed settlement", async () => {
    const ops: string[] = [];
    let calls = 0;
    const confirmed = {
      ok: true as const,
      status: "confirmed" as const,
      operationId: "stage12:burn_fenn:eff-1",
      transferId: "b1",
      recipientAddress: FENN_DEAD_ADDRESS,
      amountFormatted: "1" as const,
      tokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      chainId: ROBINHOOD_CHAIN_ID,
      purseAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      txHash: TX,
      confirmedAt: "2026-08-09T00:00:00.000Z",
      reusedExisting: false,
      isTest: true,
    };

    const executeTest = async (input: {
      operationId: string;
      actorId?: string;
    }) => {
      ops.push(input.operationId);
      calls += 1;
      if (calls === 1) {
        return { ...confirmed, reusedExisting: false };
      }
      return { ...confirmed, reusedExisting: true };
    };

    const first = await executeBurnFennViaPurse(
      {
        effectId: "eff-1",
        payload: {
          amountFormatted: "1",
          executionRail: "p1a_test",
        },
      },
      { executeTest },
    );
    const second = await executeBurnFennViaPurse(
      {
        effectId: "eff-1",
        payload: {
          amountFormatted: "1",
          executionRail: "p1a_test",
        },
      },
      { executeTest },
    );

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(first.txHash, second.txHash);
      assert.equal(second.reusedExisting, true);
      assert.equal(first.recipientAddress, FENN_DEAD_ADDRESS);
    }
    assert.deepEqual(ops, [
      "stage12:burn_fenn:eff-1",
      "stage12:burn_fenn:eff-1",
    ]);
  });

  it("ambiguous burn is not rebroadcasted by adapter mapping", async () => {
    const executeTest = async () => ({
      ok: false as const,
      code: "purse_ambiguous",
      message: "ambiguous",
      operationId: "stage12:burn_fenn:eff-amb",
      status: "ambiguous" as const,
      txHash: TX,
      failureClass: "ambiguous" as const,
    });

    const result = await executeBurnFennViaPurse(
      {
        effectId: "eff-amb",
        payload: {
          amountFormatted: "1",
          executionRail: "p1a_test",
        },
      },
      { executeTest },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failureClass, "ambiguous");
      assert.equal(result.operationId, "stage12:burn_fenn:eff-amb");
    }
  });

  it("dry-run never claims or dispatches burn", async () => {
    let purseCalls = 0;
    const admin = {
      from: () => ({}),
      rpc: async (fn: string) => {
        if (fn === "list_pending_x_perception_effects") {
          return {
            data: [
              {
                effect_id: "eff-burn-dry",
                effect_type: "burn_fenn",
                idempotency_key: "p1a:burn_fenn:dry",
                status: "pending",
                failure_class: null,
                attempt_count: 0,
                x_post_id: "9003000000000000001",
                created_at: "2026-08-09T00:00:00.000Z",
                payload_preview: "BURN p1a_test amount=1",
              },
            ],
            error: null,
          };
        }
        if (fn === "claim_x_perception_effect") {
          throw new Error("should not claim in dry_run");
        }
        return { data: null, error: null };
      },
    };

    const one = await executeOneXPerceptionEffect(
      { dryRun: true },
      {
        admin: admin as never,
        burnAdapter: {
          executeTest: async () => {
            purseCalls += 1;
            throw new Error("no");
          },
        },
      },
    );
    assert.equal(one.status, "dry_run");
    assert.equal(one.effectType, "burn_fenn");
    assert.equal(purseCalls, 0);
  });

  it("Stage 12.6 live burn_fenn completes after confirmed settlement", async () => {
    let claimed = false;
    const admin = {
      from: () => ({}),
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        if (fn === "claim_x_perception_effect") {
          if (claimed) return { data: [], error: null };
          claimed = true;
          return {
            data: [
              {
                effect_id: "eff-burn-live-1",
                authorization_id: "auth-1",
                perception_event_id: "pe-1",
                effect_type: "burn_fenn",
                idempotency_key: "p1a:burn_fenn:live",
                payload: {
                  amountFormatted: "1",
                  executionRail: "p1a_test",
                },
                status: "processing",
                attempt_count: 1,
                x_post_id: "9003000000000000002",
              },
            ],
            error: null,
          };
        }
        if (fn === "complete_x_perception_effect") {
          assert.equal(args?.p_effect_id, "eff-burn-live-1");
          assert.equal(args?.p_external_result_id, TX);
          return { data: true, error: null };
        }
        if (fn === "fail_x_perception_effect") {
          throw new Error("should not fail");
        }
        return { data: null, error: null };
      },
    };

    const one = await executeOneXPerceptionEffect(
      {},
      {
        admin: admin as never,
        burnAdapter: {
          executeTest: async (input) => {
            assert.equal(
              input.operationId,
              "stage12:burn_fenn:eff-burn-live-1",
            );
            return {
              ok: true as const,
              status: "confirmed" as const,
              operationId: input.operationId,
              transferId: "b-live",
              recipientAddress: FENN_DEAD_ADDRESS,
              amountFormatted: "1" as const,
              tokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
              chainId: ROBINHOOD_CHAIN_ID,
              purseAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              txHash: TX,
              confirmedAt: "2026-08-09T01:00:00.000Z",
              reusedExisting: false,
              isTest: true,
            };
          },
        },
      },
    );

    assert.equal(one.status, "completed");
    assert.equal(one.externalResultId, TX);
  });

  it("execute path wires burn_fenn without model planning", () => {
    const execute = read("src/lib/agent/stage126-execute.ts");
    assert.match(execute, /burn_fenn/);
    assert.match(execute, /executeBurnFennViaPurse/);
    const transfer = read("src/lib/purse/transfer.ts");
    assert.match(transfer, /actionType: "burn"/);
    assert.doesNotMatch(transfer, /function burn\(|\.burn\(/);
  });
});
