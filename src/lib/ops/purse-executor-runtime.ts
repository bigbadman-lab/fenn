/**
 * P2A dedicated production Purse Executor.
 * Orchestration only — reuses Stage 12.6 economic settlement.
 * Never judges, posts to X, writes Wall, or selects test rail.
 */

import "server-only";

import {
  STAGE126_ECONOMIC_EFFECT_TYPES,
  STAGE126_EXECUTE_BATCH_DEFAULT,
} from "@/lib/agent/execute-config";
import {
  executePendingXPerceptionEffects,
  type ExecuteBatchAggregate,
  type ExecuteOneResult,
} from "@/lib/agent/stage126-execute";
import { listPendingXPerceptionEffects } from "@/lib/agent/effect-persist";
import {
  getPurseConfig,
  tryActivateOfficialSettlement,
} from "@/lib/purse/config";
import {
  releaseOpsRuntimeLease,
  tryAcquireOpsRuntimeLease,
  type RuntimeLeaseDeps,
} from "@/lib/ops/x-agent-lease";
import type { OfficialFennTokenAsset } from "@/lib/treasury/types";

export const PURSE_EXECUTOR_LEASE_KEY_DEFAULT = "purse_executor" as const;
export const PURSE_EXECUTOR_LEASE_TTL_SECONDS_DEFAULT = 55;
export const PURSE_EXECUTOR_BATCH_DEFAULT = 1;

export type PurseExecutorRunResult = {
  ok: boolean;
  mode: "PURSE_EXECUTOR";
  result:
    | "lease_busy"
    | "idle"
    | "brake"
    | "settled"
    | "no_work"
    | "error";
  settlement: "idle" | "braked" | "active" | "skipped";
  durationMs: number;
  summary: string;
  leaseAcquired: boolean;
  economicSettlementEnabled: boolean | null;
  officialFennResolved: boolean;
  officialTokenAddress: string | null;
  officialSettlementActivatedAt: string | null;
  purseAddress: string | null;
  purseBalance: string | null;
  pendingTransferCount: number;
  pendingBurnCount: number;
  claimedEffectId: string | null;
  claimedEffectType: string | null;
  settlementResult: string | null;
  txHash: string | null;
  retryableTerminalAmbiguousReason: string | null;
  p1eFollowup: "planned" | "persisted" | "skipped" | "none";
  chainBroadcastAttempted: boolean;
  execute?: ExecuteBatchAggregate;
};

export type PurseExecutorRuntimeDeps = {
  log?: (line: string) => void;
  now?: () => number;
  lease?: RuntimeLeaseDeps;
  leaseKey?: string;
  leaseTtlSeconds?: number;
  batchSize?: number;
  getConfig?: typeof getPurseConfig;
  activateOfficial?: typeof tryActivateOfficialSettlement;
  getOfficialToken?: () => Promise<OfficialFennTokenAsset | null>;
  listPending?: typeof listPendingXPerceptionEffects;
  executeEconomic?: typeof executePendingXPerceptionEffects;
  /** Optional balance probe (never required for settle decision). */
  getPurseBalance?: (input: {
    purseAddress: string;
    tokenAddress: string;
  }) => Promise<string | null>;
};

function defaultLog(line: string): void {
  console.log(line);
}

function countByType(
  items: { effectType: string }[],
  type: string,
): number {
  return items.filter((i) => i.effectType === type).length;
}

function formatPurseExecutorSummary(r: Omit<PurseExecutorRunResult, "summary" | "execute">): string {
  return [
    "mode=PURSE_EXECUTOR",
    `result=${r.result}`,
    `settlement=${r.settlement}`,
    `leaseAcquired=${r.leaseAcquired}`,
    `economicSettlementEnabled=${r.economicSettlementEnabled}`,
    `officialFennResolved=${r.officialFennResolved}`,
    r.officialTokenAddress
      ? `officialTokenAddress=${r.officialTokenAddress}`
      : "officialTokenAddress=null",
    `officialSettlementActivatedAt=${r.officialSettlementActivatedAt ?? "null"}`,
    `purseAddress=${r.purseAddress ?? "null"}`,
    `purseBalance=${r.purseBalance ?? "null"}`,
    `pendingTransferCount=${r.pendingTransferCount}`,
    `pendingBurnCount=${r.pendingBurnCount}`,
    r.claimedEffectId ? `claimedEffectId=${r.claimedEffectId}` : null,
    r.claimedEffectType ? `claimedEffectType=${r.claimedEffectType}` : null,
    r.settlementResult ? `settlementResult=${r.settlementResult}` : null,
    r.txHash ? `txHash=${r.txHash}` : null,
    r.retryableTerminalAmbiguousReason
      ? `reason=${r.retryableTerminalAmbiguousReason}`
      : null,
    `p1eFollowup=${r.p1eFollowup}`,
    `chainBroadcastAttempted=${r.chainBroadcastAttempted}`,
    `durationMs=${r.durationMs}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function mapFollowup(one: ExecuteOneResult | undefined): PurseExecutorRunResult["p1eFollowup"] {
  if (!one || one.status !== "completed") return "none";
  if (one.p1eFollowupPersisted) return "persisted";
  if (one.p1eFollowupPlanned) return "planned";
  return "skipped";
}

/**
 * One bounded production cycle: lease → official resolve → claim economics only → settle.
 */
export async function runPurseExecutorCycle(
  deps: PurseExecutorRuntimeDeps = {},
): Promise<PurseExecutorRunResult> {
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? Date.now;
  const started = now();
  const leaseKey = (deps.leaseKey ?? PURSE_EXECUTOR_LEASE_KEY_DEFAULT).trim();
  const leaseTtl =
    deps.leaseTtlSeconds ?? PURSE_EXECUTOR_LEASE_TTL_SECONDS_DEFAULT;
  const batchSize = Math.max(
    1,
    Math.min(
      deps.batchSize ?? PURSE_EXECUTOR_BATCH_DEFAULT,
      STAGE126_EXECUTE_BATCH_DEFAULT,
    ),
  );

  const baseFields = {
    mode: "PURSE_EXECUTOR" as const,
    leaseAcquired: false,
    economicSettlementEnabled: null as boolean | null,
    officialFennResolved: false,
    officialTokenAddress: null as string | null,
    officialSettlementActivatedAt: null as string | null,
    purseAddress: null as string | null,
    purseBalance: null as string | null,
    pendingTransferCount: 0,
    pendingBurnCount: 0,
    claimedEffectId: null as string | null,
    claimedEffectType: null as string | null,
    settlementResult: null as string | null,
    txHash: null as string | null,
    retryableTerminalAmbiguousReason: null as string | null,
    p1eFollowup: "none" as const,
    chainBroadcastAttempted: false,
  };

  const leaseAttempt = await tryAcquireOpsRuntimeLease(
    { leaseKey, ttlSeconds: leaseTtl },
    deps.lease,
  );

  if (!leaseAttempt.acquired) {
    const durationMs = now() - started;
    const partial = {
      ok: true,
      ...baseFields,
      result: "lease_busy" as const,
      settlement: "skipped" as const,
      durationMs,
    };
    const summary = formatPurseExecutorSummary(partial);
    log(summary);
    return { ...partial, summary };
  }

  try {
    const getConfig = deps.getConfig ?? getPurseConfig;
    const config = await getConfig();

    if (config.configured) {
      baseFields.purseAddress = config.walletAddress;
      baseFields.officialSettlementActivatedAt =
        config.officialSettlementActivatedAt;
      baseFields.economicSettlementEnabled = config.economicSettlementEnabled;
    }

    // Fail closed if brake cannot be determined.
    if (
      !config.configured ||
      config.economicSettlementEnabled === null ||
      config.economicSettlementEnabled === undefined
    ) {
      const durationMs = now() - started;
      const partial = {
        ok: true,
        ...baseFields,
        leaseAcquired: true,
        result: "error" as const,
        settlement: "skipped" as const,
        economicSettlementEnabled: null,
        durationMs,
        retryableTerminalAmbiguousReason: "economic_settlement_enabled_unknown",
      };
      const summary = formatPurseExecutorSummary(partial);
      log(summary);
      log("official_fenn=unknown settlement=fail_closed");
      return { ...partial, summary };
    }

    if (config.economicSettlementEnabled === false) {
      // Count pendings for observability only — do not claim.
      const list = deps.listPending ?? listPendingXPerceptionEffects;
      try {
        const pending = await list(50, {
          effectTypes: STAGE126_ECONOMIC_EFFECT_TYPES,
        });
        baseFields.pendingTransferCount = countByType(pending, "transfer_fenn");
        baseFields.pendingBurnCount = countByType(pending, "burn_fenn");
      } catch {
        // non-fatal for brake path
      }

      const durationMs = now() - started;
      const partial = {
        ok: true,
        ...baseFields,
        leaseAcquired: true,
        result: "brake" as const,
        settlement: "braked" as const,
        durationMs,
      };
      const summary = formatPurseExecutorSummary(partial);
      log(summary);
      log("economic_settlement_enabled=false settlement=braked");
      return { ...partial, summary };
    }

    const getOfficial =
      deps.getOfficialToken ??
      (async () => {
        const { getOfficialFennTokenAsset } = await import(
          "@/lib/treasury/official-token"
        );
        return getOfficialFennTokenAsset();
      });

    const official = await getOfficial();
    const officialResolved = Boolean(official?.contractAddress);

    if (!officialResolved) {
      // Pre-launch healthy idle: no claim, no mutate, no chain.
      const list = deps.listPending ?? listPendingXPerceptionEffects;
      try {
        const pending = await list(50, {
          effectTypes: STAGE126_ECONOMIC_EFFECT_TYPES,
        });
        baseFields.pendingTransferCount = countByType(pending, "transfer_fenn");
        baseFields.pendingBurnCount = countByType(pending, "burn_fenn");
      } catch {
        // non-fatal
      }

      const durationMs = now() - started;
      const partial = {
        ok: true,
        ...baseFields,
        leaseAcquired: true,
        officialFennResolved: false,
        result: "idle" as const,
        settlement: "idle" as const,
        durationMs,
      };
      const summary = formatPurseExecutorSummary(partial);
      log(summary);
      log("official_fenn=unresolved settlement=idle");
      return { ...partial, summary };
    }

    baseFields.officialFennResolved = true;
    baseFields.officialTokenAddress = official!.contractAddress;

    // Activation only when official resolves. Set-once; never advances again.
    const activate = deps.activateOfficial ?? tryActivateOfficialSettlement;
    let activatedAt = config.officialSettlementActivatedAt;
    if (!activatedAt) {
      activatedAt = await activate();
    }
    baseFields.officialSettlementActivatedAt = activatedAt;

    if (!activatedAt) {
      const durationMs = now() - started;
      const partial = {
        ok: true,
        ...baseFields,
        leaseAcquired: true,
        result: "idle" as const,
        settlement: "idle" as const,
        durationMs,
        retryableTerminalAmbiguousReason: "activation_unavailable",
      };
      const summary = formatPurseExecutorSummary(partial);
      log(summary);
      return { ...partial, summary };
    }

    if (deps.getPurseBalance && config.configured) {
      try {
        baseFields.purseBalance = await deps.getPurseBalance({
          purseAddress: config.walletAddress,
          tokenAddress: official!.contractAddress,
        });
      } catch {
        baseFields.purseBalance = null;
      }
    }

    const list = deps.listPending ?? listPendingXPerceptionEffects;
    try {
      const pending = await list(50, {
        effectTypes: STAGE126_ECONOMIC_EFFECT_TYPES,
      });
      baseFields.pendingTransferCount = countByType(pending, "transfer_fenn");
      baseFields.pendingBurnCount = countByType(pending, "burn_fenn");
    } catch {
      // non-fatal
    }

    const execute =
      deps.executeEconomic ?? executePendingXPerceptionEffects;
    const executeAgg = await execute(
      {
        limit: batchSize,
        effectTypes: STAGE126_ECONOMIC_EFFECT_TYPES,
        officialSettlementActivatedAt: activatedAt,
        productionOfficialSettlement: true,
      },
      // No X reply/wall deps: speech types are never claimed.
    );

    const first = executeAgg.results[0];
    const durationMs = now() - started;

    if (!first || first.status === "empty") {
      const partial = {
        ok: true,
        ...baseFields,
        leaseAcquired: true,
        result: "no_work" as const,
        settlement: "active" as const,
        durationMs,
        p1eFollowup: "none" as const,
      };
      const summary = formatPurseExecutorSummary(partial);
      log(summary);
      return { ...partial, summary, execute: executeAgg };
    }

    const p1eFollowup = mapFollowup(first);
    const partial = {
      ok: first.status !== "failed" || first.failureClass === "retryable",
      ...baseFields,
      leaseAcquired: true,
      result: "settled" as const,
      settlement: "active" as const,
      durationMs,
      claimedEffectId: first.effectId ?? null,
      claimedEffectType: first.effectType ?? null,
      settlementResult: first.status,
      txHash: first.externalResultId ?? null,
      retryableTerminalAmbiguousReason: first.errorCode
        ? `${first.failureClass ?? "unknown"}:${first.errorCode}`
        : null,
      p1eFollowup,
      chainBroadcastAttempted: first.chainBroadcastAttempted === true,
    };
    const summary = formatPurseExecutorSummary(partial);
    log(summary);
    return { ...partial, summary, execute: executeAgg };
  } catch (error) {
    const durationMs = now() - started;
    const msg =
      error instanceof Error ? error.message.slice(0, 160) : "executor_error";
    const partial = {
      ok: false,
      ...baseFields,
      leaseAcquired: true,
      result: "error" as const,
      settlement: "skipped" as const,
      durationMs,
      retryableTerminalAmbiguousReason: msg,
      p1eFollowup: "none" as const,
    };
    const summary = formatPurseExecutorSummary(partial);
    log(summary);
    log(`[purse:settle] error: ${msg}`);
    return { ...partial, summary };
  } finally {
    try {
      await releaseOpsRuntimeLease(
        {
          leaseKey: leaseAttempt.leaseKey,
          holderId: leaseAttempt.holderId,
        },
        deps.lease,
      );
    } catch (error) {
      log(
        `[purse:settle] lease_release_failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
