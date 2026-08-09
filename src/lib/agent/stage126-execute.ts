import "server-only";

import {
  STAGE126_EXECUTE_BATCH_DEFAULT,
  STAGE126_EXECUTE_BATCH_MAX,
  type Stage126FailureClass,
} from "@/lib/agent/execute-config";
import {
  claimXPerceptionEffect,
  completeXPerceptionEffect,
  failXPerceptionEffect,
  listPendingXPerceptionEffects,
  type ClaimedEffect,
} from "@/lib/agent/effect-persist";
import {
  validateBurnFennEffectPayload,
  validateReplyEffectPayload,
  validateTransferFennEffectPayload,
  validateWallEffectPayload,
} from "@/lib/agent/effect-payload";
import { createXReplyAsFenn } from "@/lib/x/write-client";
import { writeFennWallEntry } from "@/lib/wall/write";
import { WallError } from "@/lib/wall/errors";
import { linkWallFactMemoryToEntry } from "@/lib/agent/chronicler-memory";
import {
  executeBurnFennViaPurse,
  executeTransferFennViaPurse,
  type BurnFennAdapterDeps,
  type TransferFennAdapterDeps,
} from "@/lib/agent/transfer-effect-adapter";
import { buildEconomicFollowupDraft } from "@/lib/agent/economic-followup";

type AdminLike = {
  from: (table: string) => unknown;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type ExecuteOneResult = {
  status:
    | "completed"
    | "failed"
    | "empty"
    | "dry_run"
    | "already_completed_skipped";
  effectId?: string;
  effectType?: string;
  xPostId?: string;
  attemptCount?: number;
  externalResultId?: string;
  failureClass?: Stage126FailureClass;
  errorCode?: string;
  dryRunPreview?: string;
  /** Post-confirmation trusted speech draft (P1B; not auto-posted). */
  economicFollowupPreview?: string;
};

export type ExecuteBatchAggregate = {
  scanned: number;
  completed: number;
  failed: number;
  dryRun: number;
  results: ExecuteOneResult[];
};

type Stage126Deps = {
  admin?: AdminLike;
  createReply?: typeof createXReplyAsFenn;
  writeWall?: typeof writeFennWallEntry;
  transferAdapter?: TransferFennAdapterDeps;
  burnAdapter?: BurnFennAdapterDeps;
};

function clampLimit(limit: number | undefined): number {
  const n = Math.floor(limit ?? STAGE126_EXECUTE_BATCH_DEFAULT);
  if (!Number.isFinite(n) || n < 1) return STAGE126_EXECUTE_BATCH_DEFAULT;
  return Math.min(n, STAGE126_EXECUTE_BATCH_MAX);
}

async function executeClaimedEffect(
  claimed: ClaimedEffect,
  deps: Stage126Deps,
): Promise<ExecuteOneResult> {
  const base = {
    effectId: claimed.effectId,
    effectType: claimed.effectType,
    xPostId: claimed.xPostId,
    attemptCount: claimed.attemptCount,
  };

  try {
    if (claimed.effectType === "reply_on_x") {
      const payload = validateReplyEffectPayload(
        claimed.payload,
        claimed.xPostId,
      );
      const createReply = deps.createReply ?? createXReplyAsFenn;
      const result = await createReply({
        text: payload.text,
        replyToXPostId: payload.replyToXPostId,
      });

      if (!result.ok) {
        await failXPerceptionEffect(
          {
            effectId: claimed.effectId,
            failureClass: result.class,
            lastError: `${result.code}:${result.message}`,
          },
          { admin: deps.admin },
        );
        return {
          ...base,
          status: "failed",
          failureClass: result.class,
          errorCode: result.code,
        };
      }

      await completeXPerceptionEffect(
        {
          effectId: claimed.effectId,
          externalResultId: result.tweetId,
        },
        { admin: deps.admin },
      );
      return {
        ...base,
        status: "completed",
        externalResultId: result.tweetId,
      };
    }

    if (claimed.effectType === "write_to_wall") {
      const payload = validateWallEffectPayload(
        claimed.payload,
        claimed.xPostId,
      );
      const writeWall = deps.writeWall ?? writeFennWallEntry;
      const wallResult = await writeWall({
        body: payload.body,
        sourceType: payload.sourceType,
        sourceExternalId: payload.sourceExternalId,
      });

      await completeXPerceptionEffect(
        {
          effectId: claimed.effectId,
          externalResultId: wallResult.entry.id,
        },
        { admin: deps.admin },
      );

      if (payload.chroniclerFactMemoryId) {
        await linkWallFactMemoryToEntry({
          memoryId: payload.chroniclerFactMemoryId,
          wallEntryId: wallResult.entry.id,
        });
      }

      return {
        ...base,
        status: "completed",
        externalResultId: wallResult.entry.id,
      };
    }

    if (claimed.effectType === "transfer_fenn") {
      const payload = validateTransferFennEffectPayload(claimed.payload);
      const transferResult = await executeTransferFennViaPurse(
        {
          effectId: claimed.effectId,
          payload,
        },
        deps.transferAdapter,
      );

      if (!transferResult.ok) {
        await failXPerceptionEffect(
          {
            effectId: claimed.effectId,
            failureClass: transferResult.failureClass,
            lastError: `${transferResult.code}:${transferResult.message}`,
          },
          { admin: deps.admin },
        );
        return {
          ...base,
          status: "failed",
          failureClass: transferResult.failureClass,
          errorCode: transferResult.code,
        };
      }

      await completeXPerceptionEffect(
        {
          effectId: claimed.effectId,
          externalResultId: transferResult.txHash,
        },
        { admin: deps.admin },
      );
      const followup = buildEconomicFollowupDraft({
        actionType: "transfer",
        amountFormatted: transferResult.amountFormatted,
        txHash: transferResult.txHash,
        recipientAddress: transferResult.recipientAddress,
      });
      return {
        ...base,
        status: "completed",
        externalResultId: transferResult.txHash,
        economicFollowupPreview: followup.text,
      };
    }

    if (claimed.effectType === "burn_fenn") {
      const payload = validateBurnFennEffectPayload(claimed.payload);
      const burnResult = await executeBurnFennViaPurse(
        {
          effectId: claimed.effectId,
          payload,
        },
        deps.burnAdapter,
      );

      if (!burnResult.ok) {
        await failXPerceptionEffect(
          {
            effectId: claimed.effectId,
            failureClass: burnResult.failureClass,
            lastError: `${burnResult.code}:${burnResult.message}`,
          },
          { admin: deps.admin },
        );
        return {
          ...base,
          status: "failed",
          failureClass: burnResult.failureClass,
          errorCode: burnResult.code,
        };
      }

      await completeXPerceptionEffect(
        {
          effectId: claimed.effectId,
          externalResultId: burnResult.txHash,
        },
        { admin: deps.admin },
      );
      const followup = buildEconomicFollowupDraft({
        actionType: "burn",
        amountFormatted: burnResult.amountFormatted,
        txHash: burnResult.txHash,
      });
      return {
        ...base,
        status: "completed",
        externalResultId: burnResult.txHash,
        economicFollowupPreview: followup.text,
      };
    }

    await failXPerceptionEffect(
      {
        effectId: claimed.effectId,
        failureClass: "terminal",
        lastError: "unknown_effect_type",
      },
      { admin: deps.admin },
    );
    return {
      ...base,
      status: "failed",
      failureClass: "terminal",
      errorCode: "unknown_effect_type",
    };
  } catch (error) {
    let failureClass: Stage126FailureClass = "terminal";
    let errorCode = "execution_failed";

    if (error instanceof WallError) {
      errorCode = error.code;
      failureClass =
        error.code === "wall_idempotency_conflict" ? "terminal" : "retryable";
    } else if (error instanceof Error) {
      errorCode = error.message.slice(0, 80);
      if (
        errorCode.includes("tampered") ||
        errorCode.includes("invalid_") ||
        errorCode.includes("mismatch") ||
        errorCode.includes("too_long") ||
        errorCode.includes("empty_")
      ) {
        failureClass = "terminal";
      }
    }

    try {
      await failXPerceptionEffect(
        {
          effectId: claimed.effectId,
          failureClass,
          lastError: errorCode,
        },
        { admin: deps.admin },
      );
    } catch {
      // persist failure is itself fatal for this attempt
    }

    return {
      ...base,
      status: "failed",
      failureClass,
      errorCode,
    };
  }
}

/**
 * Execute one pending/retryable authorised effect. No model calls.
 */
export async function executeOneXPerceptionEffect(
  options: { xPostId?: string; dryRun?: boolean } = {},
  deps: Stage126Deps = {},
): Promise<ExecuteOneResult> {
  if (options.dryRun) {
    const pending = await listPendingXPerceptionEffects(
      options.xPostId ? 50 : 1,
      { admin: deps.admin },
    );
    const filterId = options.xPostId?.trim();
    const filtered = filterId
      ? pending.filter((p) => p.xPostId === filterId)
      : pending;
    const item = filtered[0];
    if (!item) return { status: "empty" };
    return {
      status: "dry_run",
      effectId: item.effectId,
      effectType: item.effectType,
      xPostId: item.xPostId,
      attemptCount: item.attemptCount,
      dryRunPreview: item.payloadPreview ?? undefined,
    };
  }

  let claimed: ClaimedEffect | null;
  try {
    claimed = await claimXPerceptionEffect(
      { xPostId: options.xPostId },
      { admin: deps.admin },
    );
  } catch (error) {
    return {
      status: "failed",
      errorCode:
        error instanceof Error ? error.message.slice(0, 80) : "claim_failed",
      failureClass: "retryable",
    };
  }

  if (!claimed) return { status: "empty" };
  return executeClaimedEffect(claimed, deps);
}

export async function executePendingXPerceptionEffects(
  options: { limit?: number; xPostId?: string; dryRun?: boolean } = {},
  deps: Stage126Deps = {},
): Promise<ExecuteBatchAggregate> {
  const limit = clampLimit(options.limit);
  const results: ExecuteOneResult[] = [];
  let completed = 0;
  let failed = 0;
  let dryRun = 0;

  for (let i = 0; i < limit; i += 1) {
    const one = await executeOneXPerceptionEffect(
      { xPostId: options.xPostId, dryRun: options.dryRun },
      deps,
    );
    if (one.status === "empty") break;
    results.push(one);
    if (one.status === "completed") completed += 1;
    else if (one.status === "failed") failed += 1;
    else if (one.status === "dry_run") dryRun += 1;

    // dry-run lists without claiming — avoid infinite same-item loop
    if (options.dryRun) break;
  }

  return {
    scanned: results.length,
    completed,
    failed,
    dryRun,
    results,
  };
}

export function formatExecuteBatchReport(agg: ExecuteBatchAggregate): string {
  const lines = [
    "X effect execution",
    `scanned: ${agg.scanned}`,
    `completed: ${agg.completed}`,
    `failed: ${agg.failed}`,
    `dry_run: ${agg.dryRun}`,
  ];

  for (const r of agg.results) {
    lines.push(
      [
        `- ${r.status}`,
        `type=${r.effectType ?? "?"}`,
        `x_post_id=${r.xPostId ?? "?"}`,
        `attempt=${r.attemptCount ?? "?"}`,
        r.externalResultId ? `result=${r.externalResultId}` : null,
        r.failureClass ? `class=${r.failureClass}` : null,
        r.errorCode ? `error=${r.errorCode}` : null,
        r.dryRunPreview ? `preview=${JSON.stringify(r.dryRunPreview)}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  return lines.join("\n");
}

export function formatPendingEffectsReport(
  items: Awaited<ReturnType<typeof listPendingXPerceptionEffects>>,
): string {
  const lines = ["Pending X effects", `count: ${items.length}`];
  for (const i of items) {
    lines.push(
      [
        `- ${i.effectType}`,
        `status=${i.status}`,
        `x_post_id=${i.xPostId}`,
        `attempts=${i.attemptCount}`,
        i.failureClass ? `class=${i.failureClass}` : null,
        `key=${i.idempotencyKey}`,
        i.payloadPreview
          ? `preview=${JSON.stringify(i.payloadPreview)}`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  return lines.join("\n");
}
