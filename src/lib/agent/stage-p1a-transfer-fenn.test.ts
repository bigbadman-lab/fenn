import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  STAGE125_EFFECT_TYPES,
  stage12TransferFennEffectIdempotencyKey,
  stage12TransferPurseOperationId,
} from "@/lib/agent/authority-config";
import {
  TRANSFER_FENN_P1A_TEST_RAIL,
  validateTransferFennEffectPayload,
} from "@/lib/agent/effect-payload";
import {
  executeTransferFennViaPurse,
  mapPurseOutcomeToFailureClass,
} from "@/lib/agent/transfer-effect-adapter";
import { executeOneXPerceptionEffect } from "@/lib/agent/stage126-execute";
import type { ClaimedEffect } from "@/lib/agent/effect-persist";
import { STAGE12_LIVE_AGENT_ACTIONS } from "@/lib/agent/actions";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

const RECIPIENT = "0xcccccccccccccccccccccccccccccccccccccccc";
const TX =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("Stage P1A transfer_fenn effect contract", () => {
  it("includes transfer_fenn as a Stage 12 effect type", () => {
    assert.ok(STAGE125_EFFECT_TYPES.includes("transfer_fenn"));
    const sql = read(
      "supabase/migrations/20260809130000_55_stage_p1a_transfer_fenn.sql",
    );
    assert.match(sql, /transfer_fenn/);
    assert.match(sql, /permitted_transfer_p1a/);
  });

  it("ordinary live judgement cannot generate transfer_fenn", () => {
    assert.ok(!STAGE12_LIVE_AGENT_ACTIONS.includes("transfer_fenn" as never));
    // transfer_fenn is an economic intent + effect type, not a speech action.
    const schema = read("src/lib/agent/stage124-final-judgement-schema.ts");
    assert.doesNotMatch(
      schema,
      /action:\s*z\.enum\(STAGE12_LIVE_AGENT_ACTIONS\).*transfer_fenn/,
    );
    assert.match(schema, /economicAction/);
    const policy = read("src/lib/agent/authority-policy.ts");
    assert.match(policy, /planEconomicEffects|appendEconomicEffects/);
  });

  it("validates recipient + fixed amount and rejects token/chain/calldata", () => {
    const ok = validateTransferFennEffectPayload({
      recipientAddress: RECIPIENT,
      amountFormatted: "1",
      executionRail: TRANSFER_FENN_P1A_TEST_RAIL,
    });
    assert.equal(ok.amountFormatted, "1");
    assert.equal(ok.recipientAddress, RECIPIENT);
    assert.equal(ok.executionRail, "p1a_test");

    assert.throws(
      () =>
        validateTransferFennEffectPayload({
          recipientAddress: "not-an-address",
          amountFormatted: "1",
        }),
      /transfer_invalid_recipient/,
    );
    assert.throws(
      () =>
        validateTransferFennEffectPayload({
          recipientAddress: RECIPIENT,
          amountFormatted: "2",
        }),
      /transfer_amount_not_fixed/,
    );
    assert.throws(
      () =>
        validateTransferFennEffectPayload({
          recipientAddress: RECIPIENT,
          amountFormatted: "1",
          tokenAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
        }),
      /transfer_token_forbidden/,
    );
    assert.throws(
      () =>
        validateTransferFennEffectPayload({
          recipientAddress: RECIPIENT,
          amountFormatted: "1",
          chainId: ROBINHOOD_CHAIN_ID,
        }),
      /transfer_chain_forbidden/,
    );
    assert.throws(
      () =>
        validateTransferFennEffectPayload({
          recipientAddress: RECIPIENT,
          amountFormatted: "1",
          calldata: "0xdead",
        }),
      /transfer_calldata_forbidden/,
    );
  });

  it("derives deterministic Purse operation_id from effect id", () => {
    const a = stage12TransferPurseOperationId("effect-uuid-1");
    const b = stage12TransferPurseOperationId("effect-uuid-1");
    assert.equal(a, b);
    assert.equal(a, "stage12:transfer_fenn:effect-uuid-1");
    assert.notEqual(
      stage12TransferPurseOperationId("effect-uuid-2"),
      a,
    );
    assert.equal(
      stage12TransferFennEffectIdempotencyKey("p1a-001"),
      "p1a:transfer_fenn:p1a-001",
    );
  });

  it("maps Purse outcomes to Stage 12 failure classes", () => {
    assert.equal(mapPurseOutcomeToFailureClass("purse_ambiguous"), "ambiguous");
    assert.equal(
      mapPurseOutcomeToFailureClass("purse_lock_busy"),
      "retryable",
    );
    assert.equal(
      mapPurseOutcomeToFailureClass("purse_terminal_failed"),
      "terminal",
    );
    assert.equal(
      mapPurseOutcomeToFailureClass("purse_test_mode_production_forbidden"),
      "terminal",
    );
  });

  it("adapter uses same operation_id across retries and no rebroadcast when confirmed", async () => {
    const ops: string[] = [];
    let calls = 0;
    const confirmed = {
      ok: true as const,
      status: "confirmed" as const,
      operationId: "stage12:transfer_fenn:eff-1",
      transferId: "t1",
      recipientAddress: RECIPIENT,
      amountFormatted: "1" as const,
      tokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      chainId: ROBINHOOD_CHAIN_ID,
      purseAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      txHash: TX,
      confirmedAt: "2026-08-09T00:00:00.000Z",
      reusedExisting: false,
      isTest: true,
    };

    const first = await executeTransferFennViaPurse(
      {
        effectId: "eff-1",
        payload: {
          recipientAddress: RECIPIENT,
          amountFormatted: "1",
          executionRail: "p1a_test",
        },
      },
      {
        executeTest: async (input) => {
          calls += 1;
          ops.push(input.operationId);
          return { ...confirmed, reusedExisting: calls > 1 };
        },
      },
    );
    assert.equal(first.ok, true);
    const second = await executeTransferFennViaPurse(
      {
        effectId: "eff-1",
        payload: {
          recipientAddress: RECIPIENT,
          amountFormatted: "1",
          executionRail: "p1a_test",
        },
      },
      {
        executeTest: async (input) => {
          calls += 1;
          ops.push(input.operationId);
          return { ...confirmed, reusedExisting: true };
        },
      },
    );
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.reusedExisting, true);
    assert.deepEqual(ops, [
      "stage12:transfer_fenn:eff-1",
      "stage12:transfer_fenn:eff-1",
    ]);
    assert.equal(calls, 2);
  });

  it("ambiguous Purse settlement does not invent a new operation id", async () => {
    const ops: string[] = [];
    const result = await executeTransferFennViaPurse(
      {
        effectId: "eff-amb",
        payload: {
          recipientAddress: RECIPIENT,
          amountFormatted: "1",
          executionRail: "p1a_test",
        },
      },
      {
        executeTest: async (input) => {
          ops.push(input.operationId);
          return {
            ok: false,
            code: "purse_ambiguous",
            message: "ambiguous",
            operationId: input.operationId,
            status: "ambiguous",
            failureClass: "ambiguous",
          };
        },
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failureClass, "ambiguous");
      assert.equal(result.operationId, "stage12:transfer_fenn:eff-amb");
    }
    assert.deepEqual(ops, ["stage12:transfer_fenn:eff-amb"]);
  });

  it("Stage 12.6 dry_run never invokes Purse transfer", async () => {
    let purseCalls = 0;
    const admin = {
      from: () => ({}),
      rpc: async (fn: string) => {
        if (fn === "list_pending_x_perception_effects") {
          return {
            data: [
              {
                effect_id: "e1",
                effect_type: "transfer_fenn",
                idempotency_key: "p1a:transfer_fenn:dry",
                status: "pending",
                failure_class: null,
                attempt_count: 0,
                x_post_id: "9002000000000000001",
                created_at: "2026-08-09T00:00:00.000Z",
                payload_preview: "p1a_test 0xcc amount=1",
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
        transferAdapter: {
          executeTest: async () => {
            purseCalls += 1;
            throw new Error("no");
          },
        },
      },
    );
    assert.equal(one.status, "dry_run");
    assert.equal(one.effectType, "transfer_fenn");
    assert.equal(purseCalls, 0);
  });

  it("Stage 12.6 live transfer_fenn completes after confirmed settlement", async () => {
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
                effect_id: "eff-live-1",
                authorization_id: "auth-1",
                perception_event_id: "pe-1",
                effect_type: "transfer_fenn",
                idempotency_key: "p1a:transfer_fenn:live",
                payload: {
                  recipientAddress: RECIPIENT,
                  amountFormatted: "1",
                  executionRail: "p1a_test",
                },
                status: "processing",
                attempt_count: 1,
                x_post_id: "9002000000000000002",
              },
            ],
            error: null,
          };
        }
        if (fn === "complete_x_perception_effect") {
          assert.equal(args?.p_effect_id, "eff-live-1");
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
        transferAdapter: {
          executeTest: async (input) => {
            assert.equal(
              input.operationId,
              "stage12:transfer_fenn:eff-live-1",
            );
            return {
              ok: true,
              status: "confirmed",
              operationId: input.operationId,
              transferId: "xfer-1",
              recipientAddress: RECIPIENT,
              amountFormatted: "1",
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

  it("dispatcher does not import Treasury or expose private key", () => {
    const execute = read("src/lib/agent/stage126-execute.ts");
    assert.match(execute, /transfer_fenn/);
    assert.match(execute, /executeTransferFennViaPurse/);
    assert.doesNotMatch(execute, /FENN_PURSE_PRIVATE_KEY|privateKeyToAccount|treasury_config|FENN_TREASURY/);

    const adapter = read("src/lib/agent/transfer-effect-adapter.ts");
    assert.match(adapter, /executeManualOneFennTransfer|executeManualTestTransfer/);
    assert.doesNotMatch(adapter, /FENN_PURSE_PRIVATE_KEY|privateKeyToAccount/);
    assert.doesNotMatch(adapter, /treasury_config|FENN_TREASURY/);

    const payload = read("src/lib/agent/effect-payload.ts");
    assert.doesNotMatch(payload, /FENN_PURSE_PRIVATE_KEY/);
  });

  it("public Commons still exclude is_test settlements", () => {
    const query = read("src/lib/purse/transfers-query.ts");
    assert.match(query, /\.eq\("is_test", false\)/);
  });

  it("P1A CLI entry exists and is not a public API", () => {
    const script = read("scripts/agent-test-purse-effect.ts");
    assert.match(script, /runP1aPurseEffectTest/);
    assert.match(script, /NOT OFFICIAL FENN/);
    assert.doesNotMatch(script, /FENN_PURSE_PRIVATE_KEY/);
    assert.throws(() => read("src/app/api/agent/transfer/route.ts"));
  });

  it("reply_on_x and write_to_wall source paths remain present", () => {
    const execute = read("src/lib/agent/stage126-execute.ts");
    assert.match(execute, /reply_on_x/);
    assert.match(execute, /write_to_wall/);
    assert.match(execute, /createXReplyAsFenn|createReply/);
    assert.match(execute, /writeFennWallEntry|writeWall/);
  });
});

// Type-level smoke for ClaimedEffect remaining shape
void (null as unknown as ClaimedEffect);
