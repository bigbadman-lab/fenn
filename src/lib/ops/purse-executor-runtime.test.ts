/**
 * Stage P2A — dedicated production Purse Executor isolation tests.
 * No live X, no chain, no OpenAI, no secrets in logs.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeEffectTypeFilter,
  claimXPerceptionEffect,
} from "@/lib/agent/effect-persist";
import {
  PRE_OFFICIAL_SETTLEMENT_ACTIVATION_ERROR,
  PRODUCTION_TEST_RAIL_FORBIDDEN_ERROR,
  STAGE126_ECONOMIC_EFFECT_TYPES,
  STAGE126_SPEECH_EFFECT_TYPES,
} from "@/lib/agent/execute-config";
import {
  executeOneXPerceptionEffect,
  isEffectCreatedBeforeOfficialActivation,
} from "@/lib/agent/stage126-execute";
import { runPurseExecutorCycle } from "@/lib/ops/purse-executor-runtime";
import {
  PURSE_EXECUTOR_RUNTIME_REQUIRED_ENV,
  validatePurseExecutorRuntimeEnv,
  listMissingPurseExecutorRuntimeEnv,
} from "@/lib/ops/purse-executor-env";
import {
  X_AGENT_RUNTIME_REQUIRED_ENV,
  xAgentRequiresPursePrivateKey,
  validateXAgentRuntimeEnv,
} from "@/lib/ops/x-runtime-env";
import { stage12EconomicFollowupReplyIdempotencyKey } from "@/lib/agent/economic-followup";

const repo = process.cwd();

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("P2A claim type filters", () => {
  it("empty/invalid type filter never expands to claim-all", () => {
    assert.deepEqual(normalizeEffectTypeFilter(undefined), []);
    assert.deepEqual(normalizeEffectTypeFilter([]), []);
    assert.deepEqual(normalizeEffectTypeFilter(["not_a_type"]), []);
    assert.deepEqual(normalizeEffectTypeFilter(["reply_on_x", "bogus"]), [
      "reply_on_x",
    ]);
  });

  it("claim without types returns null (fail closed)", async () => {
    let rpcCalled = false;
    const admin = {
      from: () => ({}),
      rpc: async () => {
        rpcCalled = true;
        return { data: [{ effect_id: "x" }], error: null };
      },
    };
    const claimed = await claimXPerceptionEffect(
      {},
      { admin: admin as never },
    );
    assert.equal(claimed, null);
    assert.equal(rpcCalled, false);
  });

  it("A/B: speech claim does not accept economic types from RPC leak", async () => {
    const admin = {
      from: () => ({}),
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        assert.equal(fn, "claim_x_perception_effect");
        const types = args?.p_effect_types as string[];
        assert.ok(types.includes("reply_on_x"));
        assert.ok(!types.includes("transfer_fenn"));
        // Simulate hostile RPC returning economic type
        return {
          data: [
            {
              effect_id: "bad",
              authorization_id: "a",
              perception_event_id: "p",
              effect_type: "transfer_fenn",
              idempotency_key: "k",
              payload: {},
              status: "processing",
              attempt_count: 1,
              x_post_id: "1",
              effect_created_at: "2026-08-09T00:00:00.000Z",
            },
          ],
          error: null,
        };
      },
    };
    await assert.rejects(
      () =>
        claimXPerceptionEffect(
          { effectTypes: STAGE126_SPEECH_EFFECT_TYPES },
          { admin: admin as never },
        ),
      /outside requested filter/,
    );
  });

  it("C/D: economic claim rejects speech type leak", async () => {
    const admin = {
      from: () => ({}),
      rpc: async () => ({
        data: [
          {
            effect_id: "bad",
            authorization_id: "a",
            perception_event_id: "p",
            effect_type: "reply_on_x",
            idempotency_key: "k",
            payload: { text: "hi", replyToXPostId: "1" },
            status: "processing",
            attempt_count: 1,
            x_post_id: "1",
            effect_created_at: "2026-08-09T00:00:00.000Z",
          },
        ],
        error: null,
      }),
    };
    await assert.rejects(
      () =>
        claimXPerceptionEffect(
          { effectTypes: STAGE126_ECONOMIC_EFFECT_TYPES },
          { admin: admin as never },
        ),
      /outside requested filter/,
    );
  });
});

describe("P2A pre-activation law", () => {
  it("detects effects created before activation", () => {
    assert.equal(
      isEffectCreatedBeforeOfficialActivation(
        "2026-08-08T12:00:00.000Z",
        "2026-08-09T00:00:00.000Z",
      ),
      true,
    );
    assert.equal(
      isEffectCreatedBeforeOfficialActivation(
        "2026-08-09T00:00:00.000Z",
        "2026-08-09T00:00:00.000Z",
      ),
      false,
    );
  });

  it("I: pre-activation economic effect terminal disposition, no broadcast", async () => {
    let failError: string | null = null;
    let completeCalled = false;
    let transferCalls = 0;
    const admin = {
      from: () => ({}),
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        if (fn === "claim_x_perception_effect") {
          return {
            data: [
              {
                effect_id: "old-eff",
                authorization_id: "auth",
                perception_event_id: "pe",
                effect_type: "transfer_fenn",
                idempotency_key: "k",
                payload: {
                  recipientAddress:
                    "0xcccccccccccccccccccccccccccccccccccccccc",
                  amountFormatted: "1",
                  executionRail: "official",
                },
                status: "processing",
                attempt_count: 1,
                x_post_id: "9001",
                effect_created_at: "2026-08-01T00:00:00.000Z",
              },
            ],
            error: null,
          };
        }
        if (fn === "fail_x_perception_effect") {
          failError = String(args?.p_last_error ?? "");
          return { data: true, error: null };
        }
        if (fn === "complete_x_perception_effect") {
          completeCalled = true;
          return { data: true, error: null };
        }
        return { data: null, error: null };
      },
    };

    const one = await executeOneXPerceptionEffect(
      {
        effectTypes: STAGE126_ECONOMIC_EFFECT_TYPES,
        officialSettlementActivatedAt: "2026-08-09T12:00:00.000Z",
        productionOfficialSettlement: true,
      },
      {
        admin: admin as never,
        transferAdapter: {
          executeOfficial: async () => {
            transferCalls += 1;
            throw new Error("must not settle");
          },
        },
      },
    );

    assert.equal(one.status, "failed");
    assert.equal(one.failureClass, "terminal");
    assert.equal(one.errorCode, PRE_OFFICIAL_SETTLEMENT_ACTIVATION_ERROR);
    assert.equal(one.chainBroadcastAttempted, false);
    assert.equal(failError, PRE_OFFICIAL_SETTLEMENT_ACTIVATION_ERROR);
    assert.equal(completeCalled, false);
    assert.equal(transferCalls, 0);
  });

  it("J: post-activation economic effect reaches Stage 12.6 official path", async () => {
    let officialCalls = 0;
    const admin = {
      from: () => ({}),
      rpc: async (fn: string) => {
        if (fn === "claim_x_perception_effect") {
          return {
            data: [
              {
                effect_id: "new-eff",
                authorization_id: "auth",
                perception_event_id: "pe",
                effect_type: "transfer_fenn",
                idempotency_key: "k",
                payload: {
                  recipientAddress:
                    "0xcccccccccccccccccccccccccccccccccccccccc",
                  amountFormatted: "1",
                  executionRail: "official",
                },
                status: "processing",
                attempt_count: 1,
                x_post_id: "9001",
                effect_created_at: "2026-08-10T00:00:00.000Z",
              },
            ],
            error: null,
          };
        }
        if (fn === "complete_x_perception_effect") {
          return { data: true, error: null };
        }
        return { data: null, error: null };
      },
    };

    const one = await executeOneXPerceptionEffect(
      {
        effectTypes: STAGE126_ECONOMIC_EFFECT_TYPES,
        officialSettlementActivatedAt: "2026-08-09T12:00:00.000Z",
        productionOfficialSettlement: true,
      },
      {
        admin: admin as never,
        transferAdapter: {
          executeOfficial: async (input) => {
            officialCalls += 1;
            return {
              ok: true as const,
              status: "confirmed" as const,
              operationId: input.operationId,
              transferId: "t1",
              recipientAddress: input.recipientAddress,
              amountFormatted: "1",
              tokenAddress:
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              chainId: 20256789,
              purseAddress:
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              txHash:
                "0x1111111111111111111111111111111111111111111111111111111111111111",
              confirmedAt: "2026-08-10T01:00:00.000Z",
              reusedExisting: false,
              isTest: false,
            };
          },
          executeTest: async () => {
            throw new Error("test rail forbidden");
          },
        },
      },
    );

    assert.equal(one.status, "completed");
    assert.equal(officialCalls, 1);
    assert.equal(one.chainBroadcastAttempted, true);
  });

  it("M: production path never selects p1a_test rail", async () => {
    let testCalls = 0;
    let failError: string | null = null;
    const admin = {
      from: () => ({}),
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        if (fn === "claim_x_perception_effect") {
          return {
            data: [
              {
                effect_id: "test-rail-eff",
                authorization_id: "auth",
                perception_event_id: "pe",
                effect_type: "transfer_fenn",
                idempotency_key: "k",
                payload: {
                  recipientAddress:
                    "0xcccccccccccccccccccccccccccccccccccccccc",
                  amountFormatted: "1",
                  executionRail: "p1a_test",
                },
                status: "processing",
                attempt_count: 1,
                x_post_id: "9001",
                effect_created_at: "2026-08-10T00:00:00.000Z",
              },
            ],
            error: null,
          };
        }
        if (fn === "fail_x_perception_effect") {
          failError = String(args?.p_last_error ?? "");
          return { data: true, error: null };
        }
        return { data: null, error: null };
      },
    };

    const one = await executeOneXPerceptionEffect(
      {
        effectTypes: STAGE126_ECONOMIC_EFFECT_TYPES,
        officialSettlementActivatedAt: "2026-08-09T00:00:00.000Z",
        productionOfficialSettlement: true,
      },
      {
        admin: admin as never,
        transferAdapter: {
          executeTest: async () => {
            testCalls += 1;
            throw new Error("no");
          },
          executeOfficial: async () => {
            throw new Error("should not use official for p1a payload");
          },
        },
      },
    );

    assert.equal(one.status, "failed");
    assert.equal(one.errorCode, PRODUCTION_TEST_RAIL_FORBIDDEN_ERROR);
    assert.equal(testCalls, 0);
    assert.equal(failError, PRODUCTION_TEST_RAIL_FORBIDDEN_ERROR);
  });
});

describe("P2A Purse Executor runtime", () => {
  it("E/F: official FENN absent = healthy idle, no claim", async () => {
    let claimCalls = 0;
    let executeCalls = 0;
    const logs: string[] = [];

    const result = await runPurseExecutorCycle({
      log: (l) => logs.push(l),
      lease: {
        admin: {
          rpc: async (fn: string) => {
            if (fn === "try_acquire_ops_runtime_lease") {
              return { data: true, error: null };
            }
            if (fn === "release_ops_runtime_lease") {
              return { data: true, error: null };
            }
            return { data: null, error: null };
          },
        } as never,
      },
      getConfig: async () => ({
        configured: true,
        walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        isEnabled: true,
        officialSettlementActivatedAt: null,
        economicSettlementEnabled: true,
      }),
      getOfficialToken: async () => null,
      listPending: async () => {
        return [
          {
            effectId: "pending-tx",
            effectType: "transfer_fenn",
            idempotencyKey: "k",
            status: "pending",
            failureClass: null,
            attemptCount: 0,
            xPostId: "1",
            createdAt: "2026-08-01T00:00:00.000Z",
            payloadPreview: null,
          },
        ];
      },
      activateOfficial: async () => {
        throw new Error("must not activate without official");
      },
      executeEconomic: async () => {
        executeCalls += 1;
        claimCalls += 1;
        return {
          scanned: 0,
          completed: 0,
          failed: 0,
          dryRun: 0,
          results: [],
        };
      },
    });

    assert.equal(result.result, "idle");
    assert.equal(result.settlement, "idle");
    assert.equal(result.officialFennResolved, false);
    assert.equal(result.chainBroadcastAttempted, false);
    assert.equal(result.ok, true);
    assert.equal(executeCalls, 0);
    assert.equal(claimCalls, 0);
    assert.match(logs.join("\n"), /official_fenn=unresolved/);
    assert.match(logs.join("\n"), /settlement=idle/);
  });

  it("G/H: activation set once; later ticks do not drift", async () => {
    let activations = 0;
    const logs: string[] = [];
    const fixed = "2026-08-10T00:00:00.000Z";

    const deps = {
      log: (l: string) => logs.push(l),
      lease: {
        admin: {
          rpc: async (fn: string) => {
            if (fn === "try_acquire_ops_runtime_lease") {
              return { data: true, error: null };
            }
            if (fn === "release_ops_runtime_lease") {
              return { data: true, error: null };
            }
            return { data: null, error: null };
          },
        } as never,
      },
      getOfficialToken: async () => ({
        symbol: "VELL",
        name: "VELL",
        chainId: 1,
        contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        decimals: 18,
      }),
      listPending: async () => [],
      executeEconomic: async () => ({
        scanned: 0,
        completed: 0,
        failed: 0,
        dryRun: 0,
        results: [],
      }),
      activateOfficial: async () => {
        activations += 1;
        return fixed;
      },
    };

    // First tick: activates
    const first = await runPurseExecutorCycle({
      ...deps,
      getConfig: async () => ({
        configured: true,
        walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        isEnabled: true,
        officialSettlementActivatedAt: null,
        economicSettlementEnabled: true,
      }),
    });
    assert.equal(first.officialSettlementActivatedAt, fixed);
    assert.equal(activations, 1);

    // Second tick: already activated — do not call activate again
    const second = await runPurseExecutorCycle({
      ...deps,
      getConfig: async () => ({
        configured: true,
        walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        isEnabled: true,
        officialSettlementActivatedAt: fixed,
        economicSettlementEnabled: true,
      }),
    });
    assert.equal(second.officialSettlementActivatedAt, fixed);
    assert.equal(activations, 1, "activation must not fire again");
  });

  it("K/L: emergency brake leaves effects pending", async () => {
    let executeCalls = 0;
    const braked = await runPurseExecutorCycle({
      lease: {
        admin: {
          rpc: async (fn: string) => {
            if (fn === "try_acquire_ops_runtime_lease") {
              return { data: true, error: null };
            }
            if (fn === "release_ops_runtime_lease") {
              return { data: true, error: null };
            }
            return { data: null, error: null };
          },
        } as never,
      },
      getConfig: async () => ({
        configured: true,
        walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        isEnabled: true,
        officialSettlementActivatedAt: "2026-08-10T00:00:00.000Z",
        economicSettlementEnabled: false,
      }),
      getOfficialToken: async () => ({
        symbol: "VELL",
        name: "VELL",
        chainId: 1,
        contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        decimals: 18,
      }),
      listPending: async () => [
        {
          effectId: "e1",
          effectType: "transfer_fenn",
          idempotencyKey: "k",
          status: "pending",
          failureClass: null,
          attemptCount: 0,
          xPostId: "1",
          createdAt: "2026-08-11T00:00:00.000Z",
          payloadPreview: null,
        },
      ],
      executeEconomic: async () => {
        executeCalls += 1;
        return {
          scanned: 0,
          completed: 0,
          failed: 0,
          dryRun: 0,
          results: [],
        };
      },
    });

    assert.equal(braked.result, "brake");
    assert.equal(braked.settlement, "braked");
    assert.equal(braked.pendingTransferCount, 1);
    assert.equal(executeCalls, 0);
    assert.equal(braked.chainBroadcastAttempted, false);

    // L: brake true restored
    const restored = await runPurseExecutorCycle({
      lease: {
        admin: {
          rpc: async (fn: string) => {
            if (fn === "try_acquire_ops_runtime_lease") {
              return { data: true, error: null };
            }
            if (fn === "release_ops_runtime_lease") {
              return { data: true, error: null };
            }
            return { data: null, error: null };
          },
        } as never,
      },
      getConfig: async () => ({
        configured: true,
        walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        isEnabled: true,
        officialSettlementActivatedAt: "2026-08-10T00:00:00.000Z",
        economicSettlementEnabled: true,
      }),
      getOfficialToken: async () => ({
        symbol: "VELL",
        name: "VELL",
        chainId: 1,
        contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        decimals: 18,
      }),
      listPending: async () => [],
      executeEconomic: async (opts) => {
        executeCalls += 1;
        assert.deepEqual(
          [...(opts.effectTypes ?? [])],
          [...STAGE126_ECONOMIC_EFFECT_TYPES],
        );
        assert.equal(opts.productionOfficialSettlement, true);
        return {
          scanned: 0,
          completed: 0,
          failed: 0,
          dryRun: 0,
          results: [],
        };
      },
    });
    assert.equal(restored.result, "no_work");
    assert.equal(executeCalls, 1);
  });

  it("N/O: purse executor env does not require X OAuth or OpenAI", () => {
    assert.ok(
      !PURSE_EXECUTOR_RUNTIME_REQUIRED_ENV.includes(
        "OPENAI_API_KEY" as never,
      ),
    );
    assert.ok(
      !PURSE_EXECUTOR_RUNTIME_REQUIRED_ENV.includes(
        "X_OAUTH_CLIENT_ID" as never,
      ),
    );
    assert.ok(
      !PURSE_EXECUTOR_RUNTIME_REQUIRED_ENV.includes(
        "X_OAUTH_CLIENT_SECRET" as never,
      ),
    );
    assert.ok(
      !PURSE_EXECUTOR_RUNTIME_REQUIRED_ENV.includes("X_BEARER_TOKEN" as never),
    );

    const missing = listMissingPurseExecutorRuntimeEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      ROBINHOOD_CHAIN_RPC_URL: "https://rpc.example",
      FENN_PURSE_PRIVATE_KEY: "0x" + "ab".repeat(32),
    });
    assert.deepEqual(missing, []);

    assert.doesNotThrow(() =>
      validatePurseExecutorRuntimeEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        ROBINHOOD_CHAIN_RPC_URL: "https://rpc.example",
        FENN_PURSE_PRIVATE_KEY: "0x" + "ab".repeat(32),
        // Explicitly absent:
        OPENAI_API_KEY: undefined,
        X_OAUTH_CLIENT_ID: undefined,
        X_OAUTH_CLIENT_SECRET: undefined,
        X_BEARER_TOKEN: undefined,
      }),
    );
  });

  it("P: X Agent can operate without FENN_PURSE_PRIVATE_KEY", () => {
    assert.equal(xAgentRequiresPursePrivateKey(), false);
    assert.ok(
      !(X_AGENT_RUNTIME_REQUIRED_ENV as readonly string[]).includes(
        "FENN_PURSE_PRIVATE_KEY",
      ),
    );

    assert.doesNotThrow(() =>
      validateXAgentRuntimeEnv({
        NEXT_PUBLIC_SITE_URL: "https://askvell.com",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        NEXT_PUBLIC_PRIVY_APP_ID: "privy",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        PRIVY_APP_SECRET: "secret",
        OPENAI_API_KEY: "sk-test",
        X_BEARER_TOKEN: "bearer",
        FENN_X_USER_ID: "1234567890",
        X_OAUTH_CLIENT_ID: "cid",
        X_OAUTH_CLIENT_SECRET: "csecret",
        FENN_PURSE_PRIVATE_KEY: undefined,
      }),
    );
  });

  it("Q: P1E followup idempotency key is stable per economic effect", () => {
    const k1 = stage12EconomicFollowupReplyIdempotencyKey("eff-1");
    const k2 = stage12EconomicFollowupReplyIdempotencyKey("eff-1");
    const k3 = stage12EconomicFollowupReplyIdempotencyKey("eff-2");
    assert.equal(k1, k2);
    assert.notEqual(k1, k3);
    assert.match(k1, /^stage12:economic_followup:eff-1$/);
  });

  it("R: purse executor never imports or calls X write client", () => {
    const runtime = read("src/lib/ops/purse-executor-runtime.ts");
    assert.doesNotMatch(runtime, /createXReplyAsFenn|write-client|tweet\.write/);
    assert.doesNotMatch(runtime, /getOpenAIClient|\bopenai\b/);
    assert.doesNotMatch(runtime, /p1a_test|executeManualTestTransfer/);
    assert.match(runtime, /STAGE126_ECONOMIC_EFFECT_TYPES/);
    assert.match(runtime, /productionOfficialSettlement:\s*true/);
  });

  it("pipeline defaults to speech-only execute scope", () => {
    const pipeline = read("src/lib/ops/x-pipeline-runtime.ts");
    assert.match(pipeline, /STAGE126_SPEECH_EFFECT_TYPES/);
    assert.match(pipeline, /speech only/);
    assert.doesNotMatch(
      pipeline,
      /effectTypes:\s*STAGE126_ECONOMIC_EFFECT_TYPES/,
    );
  });
});

describe("P2A architecture files", () => {
  it("migration adds activation, brake, type filter, reclaim", () => {
    const mig = join(
      repo,
      "supabase/migrations/20260809200000_61_purse_p2a_executor.sql",
    );
    assert.ok(existsSync(mig));
    const sql = readFileSync(mig, "utf8");
    assert.match(sql, /official_settlement_activated_at/);
    assert.match(sql, /economic_settlement_enabled/);
    assert.match(sql, /try_activate_official_settlement/);
    assert.match(sql, /p_effect_types/);
    assert.match(sql, /SKIP LOCKED/);
    assert.match(sql, /15 minutes/);
    assert.match(sql, /DEFAULT true/);
  });

  it("render + package expose purse:settle without key on X agent", () => {
    const yaml = read("render.yaml");
    assert.match(yaml, /fenn-purse-executor/);
    assert.match(yaml, /npm run purse:settle/);
    assert.match(yaml, /FENN_PURSE_PRIVATE_KEY/);
    // X agent section must not list the private key as an env var
    const xSection = yaml.split("fenn-purse-executor")[0] ?? "";
    assert.doesNotMatch(
      xSection,
      /key:\s*FENN_PURSE_PRIVATE_KEY/,
    );

    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["purse:settle"] ?? "", /purse-settle/);
  });

  it("S: ambiguous failure class still classified on adapter", async () => {
    const { mapPurseOutcomeToFailureClass } = await import(
      "@/lib/agent/transfer-effect-adapter"
    );
    assert.equal(
      mapPurseOutcomeToFailureClass("purse_ambiguous", "ambiguous"),
      "ambiguous",
    );
  });
});
