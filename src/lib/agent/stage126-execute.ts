import "server-only";

import {
  PRE_OFFICIAL_SETTLEMENT_ACTIVATION_ERROR,
  PRODUCTION_TEST_RAIL_FORBIDDEN_ERROR,
  STAGE126_EXECUTE_BATCH_DEFAULT,
  STAGE126_EXECUTE_BATCH_MAX,
  STAGE126_SPEECH_EFFECT_TYPES,
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
import { planEconomicCompletionFollowup } from "@/lib/agent/economic-completion-plan";

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
  /** Post-confirmation trusted speech draft (P1B/P1E; not auto-posted). */
  economicFollowupPreview?: string;
  /** Whether a durable P1E reply_on_x was planned/persisted. */
  p1eFollowupPlanned?: boolean;
  p1eFollowupPersisted?: boolean;
  chainBroadcastAttempted?: boolean;
};

export type ExecuteBatchAggregate = {
  scanned: number;
  completed: number;
  failed: number;
  dryRun: number;
  results: ExecuteOneResult[];
};

export type Stage126ExecuteOptions = {
  xPostId?: string;
  dryRun?: boolean;
  /**
   * Claim type filter. Defaults to speech-only (X Agent production scope).
   * Empty array claims nothing. Never defaults to "all types".
   */
  effectTypes?: readonly string[];
  /**
   * Official settlement activation instant (ISO). When set, economic effects
   * created strictly before this instant fail terminal without broadcast.
   * Null/omitted: no pre-activation gate (caller must ensure gate when needed).
   */
  officialSettlementActivatedAt?: string | null;
  /**
   * Production Purse Executor: official rail only; refuse p1a_test payload;
   * P1E uses deterministic fallback speech (no OpenAI).
   */
  productionOfficialSettlement?: boolean;
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

function resolveClaimEffectTypes(
  options: Stage126ExecuteOptions,
): readonly string[] {
  if (options.effectTypes !== undefined) {
    return options.effectTypes;
  }
  return STAGE126_SPEECH_EFFECT_TYPES;
}

/**
 * effect.created_at < activation → never may settle against official token.
 */
export function isEffectCreatedBeforeOfficialActivation(
  effectCreatedAt: string | null | undefined,
  activatedAt: string | null | undefined,
): boolean {
  if (!effectCreatedAt?.trim() || !activatedAt?.trim()) return false;
  const createdMs = Date.parse(effectCreatedAt);
  const activatedMs = Date.parse(activatedAt);
  if (!Number.isFinite(createdMs) || !Number.isFinite(activatedMs)) return false;
  return createdMs < activatedMs;
}

async function executeClaimedEffect(
  claimed: ClaimedEffect,
  options: Stage126ExecuteOptions,
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

    if (
      claimed.effectType === "transfer_fenn" ||
      claimed.effectType === "burn_fenn"
    ) {
      if (
        isEffectCreatedBeforeOfficialActivation(
          claimed.createdAt,
          options.officialSettlementActivatedAt,
        )
      ) {
        await failXPerceptionEffect(
          {
            effectId: claimed.effectId,
            failureClass: "terminal",
            lastError: PRE_OFFICIAL_SETTLEMENT_ACTIVATION_ERROR,
          },
          { admin: deps.admin },
        );
        return {
          ...base,
          status: "failed",
          failureClass: "terminal",
          errorCode: PRE_OFFICIAL_SETTLEMENT_ACTIVATION_ERROR,
          chainBroadcastAttempted: false,
        };
      }

      if (
        options.productionOfficialSettlement &&
        claimed.payload.executionRail === "p1a_test"
      ) {
        await failXPerceptionEffect(
          {
            effectId: claimed.effectId,
            failureClass: "terminal",
            lastError: PRODUCTION_TEST_RAIL_FORBIDDEN_ERROR,
          },
          { admin: deps.admin },
        );
        return {
          ...base,
          status: "failed",
          failureClass: "terminal",
          errorCode: PRODUCTION_TEST_RAIL_FORBIDDEN_ERROR,
          chainBroadcastAttempted: false,
        };
      }
    }

    if (claimed.effectType === "transfer_fenn") {
      const payload = validateTransferFennEffectPayload(claimed.payload);
      const interactionId =
        typeof claimed.payload.economicInteractionId === "string"
          ? claimed.payload.economicInteractionId.trim()
          : "";
      const transferResult = await executeTransferFennViaPurse(
        {
          effectId: claimed.effectId,
          payload,
          forceOfficialRail: options.productionOfficialSettlement === true,
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
        if (interactionId) {
          try {
            const { markEconomicInteractionFailed } = await import(
              "@/lib/agent/economic-interaction-persist"
            );
            await markEconomicInteractionFailed({
              interactionId,
              reason: `${transferResult.code}:${transferResult.message}`,
              admin: deps.admin as never,
            });
          } catch {
            // non-fatal
          }
        }
        return {
          ...base,
          status: "failed",
          failureClass: transferResult.failureClass,
          errorCode: transferResult.code,
          chainBroadcastAttempted: transferResult.failureClass !== "terminal",
        };
      }

      await completeXPerceptionEffect(
        {
          effectId: claimed.effectId,
          externalResultId: transferResult.txHash,
        },
        { admin: deps.admin },
      );
      if (interactionId) {
        try {
          const { markEconomicInteractionCompleted, tryLinkTransferEffect } =
            await import("@/lib/agent/economic-interaction-persist");
          await tryLinkTransferEffect({
            interactionId,
            effectId: claimed.effectId,
            admin: deps.admin as never,
          });
          await markEconomicInteractionCompleted({
            interactionId,
            admin: deps.admin as never,
          });
        } catch {
          // non-fatal
        }
      }

      // P1E: confirmed settlement only → durable reply_on_x (never posts here).
      let economicFollowupPreview: string | undefined;
      let p1eFollowupPlanned = false;
      let p1eFollowupPersisted = false;
      try {
        const follow = await planEconomicCompletionFollowup({
          actionType: "transfer",
          amountFormatted: transferResult.amountFormatted,
          txHash: transferResult.txHash,
          confirmedAt: transferResult.confirmedAt,
          isTest: transferResult.isTest,
          economicEffectId: claimed.effectId,
          sourceXPostId: claimed.xPostId,
          authorizationId: claimed.authorizationId,
          perceptionEventId: claimed.perceptionEventId,
          recipientAddress: transferResult.recipientAddress,
          economicInteractionId: interactionId || null,
          admin: deps.admin as never,
          forceSpeechFallback:
            options.productionOfficialSettlement === true,
        });
        economicFollowupPreview = follow.speech?.replyText;
        p1eFollowupPlanned = follow.replyEffectPlanned;
        p1eFollowupPersisted = follow.replyEffectPersisted;
      } catch {
        const followup = buildEconomicFollowupDraft({
          actionType: "transfer",
          amountFormatted: transferResult.amountFormatted,
          txHash: transferResult.txHash,
          recipientAddress: transferResult.recipientAddress,
        });
        economicFollowupPreview = followup.text;
      }
      return {
        ...base,
        status: "completed",
        externalResultId: transferResult.txHash,
        economicFollowupPreview,
        p1eFollowupPlanned,
        p1eFollowupPersisted,
        chainBroadcastAttempted: true,
      };
    }

    if (claimed.effectType === "burn_fenn") {
      const payload = validateBurnFennEffectPayload(claimed.payload);
      const burnResult = await executeBurnFennViaPurse(
        {
          effectId: claimed.effectId,
          payload,
          forceOfficialRail: options.productionOfficialSettlement === true,
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

      let economicFollowupPreview: string | undefined;
      let p1eFollowupPlanned = false;
      let p1eFollowupPersisted = false;
      try {
        const follow = await planEconomicCompletionFollowup({
          actionType: "burn",
          amountFormatted: burnResult.amountFormatted,
          txHash: burnResult.txHash,
          confirmedAt: burnResult.confirmedAt,
          isTest: burnResult.isTest,
          economicEffectId: claimed.effectId,
          sourceXPostId: claimed.xPostId,
          authorizationId: claimed.authorizationId,
          perceptionEventId: claimed.perceptionEventId,
          recipientAddress: burnResult.recipientAddress,
          admin: deps.admin as never,
          forceSpeechFallback:
            options.productionOfficialSettlement === true,
        });
        economicFollowupPreview = follow.speech?.replyText;
        p1eFollowupPlanned = follow.replyEffectPlanned;
        p1eFollowupPersisted = follow.replyEffectPersisted;
      } catch {
        const followup = buildEconomicFollowupDraft({
          actionType: "burn",
          amountFormatted: burnResult.amountFormatted,
          txHash: burnResult.txHash,
        });
        economicFollowupPreview = followup.text;
      }
      return {
        ...base,
        status: "completed",
        externalResultId: burnResult.txHash,
        economicFollowupPreview,
        p1eFollowupPlanned,
        p1eFollowupPersisted,
        chainBroadcastAttempted: true,
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
 * Execute one pending/retryable authorised effect. No model calls on speech path.
 * Default claim scope is speech-only (reply_on_x / write_to_wall).
 */
export async function executeOneXPerceptionEffect(
  options: Stage126ExecuteOptions = {},
  deps: Stage126Deps = {},
): Promise<ExecuteOneResult> {
  const effectTypes = resolveClaimEffectTypes(options);

  if (options.dryRun) {
    const pending = await listPendingXPerceptionEffects(
      options.xPostId ? 50 : 1,
      { admin: deps.admin, effectTypes },
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
      { xPostId: options.xPostId, effectTypes },
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
  return executeClaimedEffect(claimed, options, deps);
}

export async function executePendingXPerceptionEffects(
  options: Stage126ExecuteOptions & { limit?: number } = {},
  deps: Stage126Deps = {},
): Promise<ExecuteBatchAggregate> {
  const limit = clampLimit(options.limit);
  const results: ExecuteOneResult[] = [];
  let completed = 0;
  let failed = 0;
  let dryRun = 0;

  for (let i = 0; i < limit; i += 1) {
    const one = await executeOneXPerceptionEffect(
      {
        xPostId: options.xPostId,
        dryRun: options.dryRun,
        effectTypes: options.effectTypes,
        officialSettlementActivatedAt: options.officialSettlementActivatedAt,
        productionOfficialSettlement: options.productionOfficialSettlement,
      },
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
