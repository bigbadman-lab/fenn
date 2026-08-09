import "server-only";

import {
  STAGE125_AUTHORITY_BATCH_DEFAULT,
  STAGE125_AUTHORITY_BATCH_MAX,
} from "@/lib/agent/authority-config";
import {
  claimXPerceptionForAuthority,
  inspectAuthorizationByXPostId,
  persistXPerceptionAuthorization,
  type ClaimedAuthorityJudgement,
} from "@/lib/agent/authority-persist";
import { evaluateAuthorityDecision } from "@/lib/agent/authority-policy";
import {
  applyReplyGuaranteePolicy,
  isHardBlockReasonCode,
} from "@/lib/agent/reply-guarantee-policy";
import type { ReplyRecoveryModelCaller } from "@/lib/agent/reply-recovery";
import { evaluateChroniclerWallAdmission } from "@/lib/agent/chronicler-evaluate";
import { loadTrustedFactsForChronicler } from "@/lib/agent/chronicler-load-facts";
import {
  attachAuthorizationToWallFactMemory,
  isWallFactFingerprintRemembered,
  tryReserveWallFactMemory,
} from "@/lib/agent/chronicler-memory";
import { inferResponseModeFromBody } from "@/lib/agent/response-mode";
import type { WallCandidate } from "@/lib/agent/chronicler-types";
import { ensureReplyWithQualityGate } from "@/lib/agent/speech-quality";

type AdminLike = {
  from: (table: string) => unknown;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type AuthorizeOneResult = {
  status:
    | "authorised"
    | "already_authorised"
    | "empty"
    | "failed"
    | "reply_generation_failed";
  xPostId?: string;
  perceptionEventId?: string;
  judgementId?: string;
  finalAction?: string;
  outcome?: string;
  policyCode?: string;
  /** reply_only | wall_and_reply | blocked | reply_generation_failed … */
  policyOutcome?: string;
  effectsCreated?: number;
  /** Observability: whether focused recovery ran. */
  replyRecovery?:
    | "not_needed"
    | "succeeded"
    | "failed"
    | "skipped"
    | "quality_repaired";
  recoveryCalls?: number;
  /** Stage 4 quality / Wall suppress diagnostics */
  speechQuality?: {
    violations: string[];
    wallSuppressed: boolean;
    wallSuppressReasons: string[];
  };
  /** Stage 3 Chronicler observability */
  chronicler?: {
    decision: string;
    code: string;
    kind: string | null;
    factKey: string | null;
    factFingerprint: string | null;
    admitted: boolean;
    alreadyRemembered: boolean;
  };
  error?: string;
};

export type AuthorizeBatchAggregate = {
  scanned: number;
  authorised: number;
  alreadyAuthorised: number;
  failed: number;
  replyGenerationFailed: number;
  results: AuthorizeOneResult[];
};

type Stage125Deps = {
  admin?: AdminLike;
  callReplyRecovery?: ReplyRecoveryModelCaller;
  /** Test override: trust facts without DB. */
  loadTrustedFacts?: typeof loadTrustedFactsForChronicler;
  isRemembered?: typeof isWallFactFingerprintRemembered;
  tryReserve?: typeof tryReserveWallFactMemory;
  callWalletSpeechModel?: import("@/lib/agent/wallet-speech").WalletSpeechModelCaller;
  forceWalletSpeechFallback?: boolean;
};

function clampBatchLimit(limit: number | undefined): number {
  const n = Math.floor(limit ?? STAGE125_AUTHORITY_BATCH_DEFAULT);
  if (!Number.isFinite(n) || n < 1) return STAGE125_AUTHORITY_BATCH_DEFAULT;
  return Math.min(n, STAGE125_AUTHORITY_BATCH_MAX);
}

/**
 * Claim one finalized judgement, recover reply if needed, Chronicler admit,
 * evaluate policy, persist authority + pending effects. Does not execute.
 *
 * Ordering for public_fact Walls:
 * 1) pure Chronicler evaluate (with remembered lookup)
 * 2) tryReserve fingerprint (unique constraint = final race gate)
 * 3) pure evaluateAuthorityDecision plans effects
 * 4) persist auth+effects
 * 5) optional attach authorization_id to memory
 *
 * Rejection of Wall never blocks reply; never wall-only.
 */
export async function authorizeOneXPerception(
  deps: Stage125Deps = {},
): Promise<AuthorizeOneResult> {
  let claimed: ClaimedAuthorityJudgement | null;
  try {
    claimed = await claimXPerceptionForAuthority({ admin: deps.admin });
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "claim failed",
    };
  }

  if (!claimed) return { status: "empty" };

  if (claimed.alreadyAuthorised) {
    const existing = await inspectAuthorizationByXPostId(claimed.xPostId, {
      admin: deps.admin,
    });
    return {
      status: "already_authorised",
      xPostId: claimed.xPostId,
      perceptionEventId: claimed.perceptionEventId,
      judgementId: claimed.judgementId,
      finalAction: existing?.finalAction ?? claimed.finalAction ?? undefined,
      outcome: existing?.outcome,
      policyCode: existing?.policyCode,
      policyOutcome:
        existing?.outcome === "permitted"
          ? existing.effects.some((e) => e.effectType === "write_to_wall")
            ? "wall_and_reply"
            : existing.effects.some((e) => e.effectType === "reply_on_x")
              ? "reply_only"
              : "blocked"
          : "blocked",
      effectsCreated: existing?.effects.length ?? 0,
      replyRecovery: "not_needed",
      recoveryCalls: 0,
    };
  }

  try {
    const guaranteed = applyReplyGuaranteePolicy({
      engage:
        claimed.finalAction !== "do_nothing" &&
        !isHardBlockReasonCode(claimed.finalReasonCode),
      action: claimed.finalAction ?? "do_nothing",
      reasonCode: claimed.finalReasonCode ?? "insufficient_knowledge",
      replyText: claimed.finalReplyText,
      wallBody: claimed.finalWallBody,
      allowDeferredLiveSilence: false,
    });

    let finalAction = guaranteed.action;
    let finalReplyText = guaranteed.replyText;
    let finalWallBody = guaranteed.wallBody;
    let finalReasonCode = guaranteed.reasonCode;
    let replyRecovery: AuthorizeOneResult["replyRecovery"] = "not_needed";
    let recoveryCalls = 0;
    let speechQuality: AuthorizeOneResult["speechQuality"];

    // Stage 4: load facts first so recovery + quality gate share Stage 2 evidence.
    const responseMode = inferResponseModeFromBody(claimed.body);
    const loadFacts = deps.loadTrustedFacts ?? loadTrustedFactsForChronicler;
    const trustedFacts = await loadFacts({
      body: claimed.body,
      needsLiveState: claimed.needsLiveState,
      wallCandidate: claimed.finalWallCandidate,
    });

    // P1D.1: when an economic interaction is in-flight for this author, do not let
    // unconstrained quality recovery rewrite fact-locked wallet speech.
    let skipQualityRecovery = false;
    try {
      const { findActiveEconomicInteractionForAuthor } = await import(
        "@/lib/agent/economic-interaction-persist"
      );
      const activeWalletIx = await findActiveEconomicInteractionForAuthor({
        authorXUserId: claimed.authorXUserId,
        admin: deps.admin as never,
      });
      if (
        activeWalletIx &&
        (activeWalletIx.status === "awaiting_wallet" ||
          activeWalletIx.status === "awaiting_wallet_confirmation" ||
          activeWalletIx.status === "wallet_confirmed" ||
          activeWalletIx.status === "executing")
      ) {
        skipQualityRecovery = true;
      }
    } catch {
      // non-fatal
    }

    if (
      finalAction === "reply_on_x" ||
      finalAction === "reply_and_write_to_wall"
    ) {
      if (skipQualityRecovery) {
        finalReplyText =
          finalReplyText?.trim() && finalReplyText.trim().length > 0
            ? finalReplyText.trim().slice(0, 280)
            : finalReplyText;
        replyRecovery = "skipped";
        speechQuality = {
          violations: [],
          wallSuppressed: false,
          wallSuppressReasons: [],
        };
      } else {
      const knowledgeBoundary =
        !claimed.liveStateAvailable && claimed.needsLiveState.length > 0
          ? "Trusted live state was unavailable. Answer honestly that you cannot establish the current figure; do not invent numbers."
          : "Answer only from public knowledge implied by the mention. Do not invent private Outlaw facts or live balances.";

      const quality = await ensureReplyWithQualityGate({
        action: finalAction,
        reasonCode: finalReasonCode,
        replyText: finalReplyText,
        wallBody: finalWallBody,
        xPostId: claimed.xPostId,
        perceptionType: claimed.perceptionType,
        authorXUserId: claimed.authorXUserId,
        authorUsername: null,
        body: claimed.body,
        knowledgeBoundaryNote: knowledgeBoundary,
        trustedFacts,
        responseMode,
        callModel: deps.callReplyRecovery,
      });

      recoveryCalls = quality.recoveryCalls;
      speechQuality = {
        violations: quality.qualityViolations,
        wallSuppressed: quality.wallSuppressed,
        wallSuppressReasons: quality.wallSuppressReasons,
      };

      if (quality.replyRecovery === "failed" || !quality.replyText) {
        return {
          status: "reply_generation_failed",
          xPostId: claimed.xPostId,
          perceptionEventId: claimed.perceptionEventId,
          judgementId: claimed.judgementId,
          finalAction,
          policyCode: "reply_generation_failed",
          policyOutcome: "reply_generation_failed",
          effectsCreated: 0,
          replyRecovery: "failed",
          recoveryCalls,
          speechQuality,
          error: quality.error ?? "reply quality path failed",
        };
      }

      finalReplyText = quality.replyText;
      replyRecovery = quality.replyRecovery;
      if (quality.wallSuppressed) {
        finalWallBody = null;
        if (finalAction === "reply_and_write_to_wall") {
          finalAction = "reply_on_x";
        }
      } else {
        finalWallBody = quality.wallBody;
      }
      }
    }

    // --- Stage 3 Chronicler (I/O outside pure authority) ---
    let alreadyRemembered = false;
    const rawCandidate = claimed.finalWallCandidate;
    if (
      rawCandidate &&
      typeof rawCandidate === "object" &&
      (rawCandidate as WallCandidate).kind === "public_fact"
    ) {
      const pf = rawCandidate as Extract<WallCandidate, { kind: "public_fact" }>;
      const checkRemembered = deps.isRemembered ?? isWallFactFingerprintRemembered;
      alreadyRemembered = await checkRemembered({
        factKey: pf.factKey,
        factFingerprint: pf.factFingerprint,
      });
    }

    let chronicler = evaluateChroniclerWallAdmission({
      finalAction,
      finalReplyText,
      finalWallBody,
      wallCandidate: claimed.finalWallCandidate,
      trustedFacts,
      alreadyRemembered,
      responseMode,
    });

    let reservedMemoryId: string | null = null;

    if (chronicler.decision === "allow_wall" && chronicler.candidate) {
      if (chronicler.candidate.kind === "public_fact") {
        const reserve = deps.tryReserve ?? tryReserveWallFactMemory;
        const reserved = await reserve({
          factKey: chronicler.candidate.factKey,
          factFingerprint: chronicler.candidate.factFingerprint,
          reason: chronicler.candidate.reason,
          perceptionEventId: claimed.perceptionEventId,
        });
        if (reserved.status === "already_exists") {
          finalAction = "reply_on_x";
          finalWallBody = null;
          chronicler = {
            ...chronicler,
            decision: "suppress_wall",
            code: "already_remembered",
            observability: {
              ...chronicler.observability,
              admitted: false,
              alreadyRemembered: true,
            },
          };
        } else if (reserved.status === "failed") {
          finalAction = "reply_on_x";
          finalWallBody = null;
          chronicler = {
            ...chronicler,
            decision: "suppress_wall",
            code: "significance_rejected",
            observability: {
              ...chronicler.observability,
              admitted: false,
            },
          };
        } else {
          reservedMemoryId = reserved.memoryId;
          finalAction = "reply_and_write_to_wall";
        }
      } else {
        finalAction = "reply_and_write_to_wall";
      }
    } else if (finalAction === "reply_and_write_to_wall") {
      finalAction = "reply_on_x";
      finalWallBody = null;
    }

    // P1D: wallet_confirmed interaction re-enters with frozen intent (not judgement alone).
    const economicBundle = await buildLiveEconomicContext(claimed, deps.admin);
    const decision = evaluateAuthorityDecision({
      perceptionEventId: claimed.perceptionEventId,
      judgementId: claimed.judgementId,
      xPostId: claimed.xPostId,
      perceptionType: claimed.perceptionType,
      finalStatus: claimed.finalStatus,
      finalAction,
      finalReplyText,
      finalWallBody,
      finalReasonCode,
      finalEconomicIntent:
        economicBundle.overrideEconomicIntent ?? claimed.finalEconomicIntent,
      economicContext: economicBundle.context,
    });

    // P1D: pending destination → create durable interaction; Book-of-Speech wallet ask.
    let finalDecision = decision;
    if (decision.pendingDestination === true) {
      finalDecision = await applyPendingDestinationSideEffects({
        claimed,
        decision,
        finalReplyText,
        admin: deps.admin,
        callWalletSpeechModel: deps.callWalletSpeechModel,
        forceWalletSpeechFallback: deps.forceWalletSpeechFallback,
      });
    }

    // P1D.1: confirmed wallet re-entry refused → fail interaction + refuse speech.
    if (
      economicBundle.overrideEconomicIntent &&
      economicBundle.context.economicInteractionId &&
      !finalDecision.effects.some((e) => e.type === "transfer_fenn") &&
      finalDecision.economicSkippedReason &&
      finalDecision.economicSkippedReason !== "pending_destination"
    ) {
      finalDecision = await applyEconomicRefusalAfterConfirm({
        claimed,
        decision: finalDecision,
        interactionId: economicBundle.context.economicInteractionId,
        confirmedWallet: economicBundle.context.interactionConfirmedWallet,
        amountFormatted:
          typeof (
            economicBundle.overrideEconomicIntent as { proposedAmount?: string }
          ).proposedAmount === "string"
            ? (economicBundle.overrideEconomicIntent as { proposedAmount: string })
                .proposedAmount
            : undefined,
        admin: deps.admin,
        callWalletSpeechModel: deps.callWalletSpeechModel,
        forceWalletSpeechFallback: deps.forceWalletSpeechFallback,
      });
    }

    // Attach Chronicler memory id into wall effect payload when planned.
    if (reservedMemoryId && finalDecision.outcome === "permitted") {
      for (const effect of finalDecision.effects) {
        if (effect.type === "write_to_wall") {
          effect.payload = {
            ...effect.payload,
            chroniclerFactMemoryId: reservedMemoryId,
          };
        }
      }
    }

    const isDeskWallOnly =
      finalDecision.policyCode === "permitted_wall" &&
      finalDecision.effects.every((e) => e.type === "write_to_wall");

    const isEconomicOnly =
      finalDecision.outcome === "permitted" &&
      !finalDecision.effects.some((e) => e.type === "reply_on_x") &&
      finalDecision.effects.some(
        (e) => e.type === "transfer_fenn" || e.type === "burn_fenn",
      );

    if (
      finalDecision.outcome === "permitted" &&
      !isDeskWallOnly &&
      !isEconomicOnly &&
      !finalDecision.effects.some((e) => e.type === "reply_on_x")
    ) {
      return {
        status: "reply_generation_failed",
        xPostId: claimed.xPostId,
        perceptionEventId: claimed.perceptionEventId,
        judgementId: claimed.judgementId,
        finalAction: finalDecision.finalAction,
        policyOutcome: "policy_invariant_violation",
        effectsCreated: 0,
        replyRecovery,
        recoveryCalls,
        chronicler: {
          decision: chronicler.decision,
          code: chronicler.code,
          kind: chronicler.observability.kind,
          factKey: chronicler.observability.factKey,
          factFingerprint: chronicler.observability.factFingerprint,
          admitted: chronicler.observability.admitted,
          alreadyRemembered: chronicler.observability.alreadyRemembered,
        },
        error: "eligible permitted plan has no reply effect",
      };
    }

    if (
      (finalAction === "reply_on_x" ||
        finalAction === "reply_and_write_to_wall") &&
      (finalDecision.policyCode === "missing_reply_candidate" ||
        (finalDecision.effects.length === 0 &&
          finalDecision.outcome === "denied"))
    ) {
      return {
        status: "reply_generation_failed",
        xPostId: claimed.xPostId,
        perceptionEventId: claimed.perceptionEventId,
        judgementId: claimed.judgementId,
        finalAction,
        policyCode: finalDecision.policyCode,
        policyOutcome: "reply_generation_failed",
        effectsCreated: 0,
        replyRecovery: replyRecovery === "not_needed" ? "failed" : replyRecovery,
        recoveryCalls,
        error: "reply candidate still missing after recovery path",
      };
    }

    const persisted = await persistXPerceptionAuthorization(
      {
        perceptionEventId: claimed.perceptionEventId,
        judgementId: claimed.judgementId,
        decision: finalDecision,
      },
      { admin: deps.admin },
    );

    // Link transfer effect to economic interaction when present (idempotent).
    if (persisted.created) {
      await maybeLinkEconomicInteractionTransfer({
        decision: finalDecision,
        admin: deps.admin,
      });
    }

    if (reservedMemoryId && persisted.created && persisted.authorizationId) {
      try {
        await attachAuthorizationToWallFactMemory({
          memoryId: reservedMemoryId,
          authorizationId: persisted.authorizationId,
          // Prefer injected admin when present; optional link must never fail the tick.
          admin: deps.admin as never,
        });
      } catch {
        // non-fatal link
      }
    }

    if (!persisted.created) {
      return {
        status: "already_authorised",
        xPostId: claimed.xPostId,
        perceptionEventId: claimed.perceptionEventId,
        judgementId: claimed.judgementId,
        finalAction: finalDecision.finalAction,
        outcome: persisted.outcome,
        policyCode: persisted.policyCode,
        policyOutcome: finalDecision.policyOutcome,
        effectsCreated: persisted.effectsCreated,
        replyRecovery,
        recoveryCalls,
        chronicler: {
          decision: chronicler.decision,
          code: chronicler.code,
          kind: chronicler.observability.kind,
          factKey: chronicler.observability.factKey,
          factFingerprint: chronicler.observability.factFingerprint,
          admitted: chronicler.observability.admitted,
          alreadyRemembered: chronicler.observability.alreadyRemembered,
        },
      };
    }

    console.info("[chronicler] authority", {
      xPostId: claimed.xPostId,
      decision: chronicler.decision,
      code: chronicler.code,
      kind: chronicler.observability.kind,
      factKey: chronicler.observability.factKey,
      factFingerprint: chronicler.observability.factFingerprint,
      admitted: chronicler.observability.admitted,
      alreadyRemembered: chronicler.observability.alreadyRemembered,
      finalAction: finalDecision.finalAction,
      policyCode: persisted.policyCode,
      speechQuality,
    });

    return {
      status: "authorised",
      xPostId: claimed.xPostId,
      perceptionEventId: claimed.perceptionEventId,
      judgementId: claimed.judgementId,
      finalAction: finalDecision.finalAction,
      outcome: persisted.outcome,
      policyCode: persisted.policyCode,
      policyOutcome: finalDecision.policyOutcome,
      effectsCreated: persisted.effectsCreated,
      replyRecovery,
      recoveryCalls,
      speechQuality,
      chronicler: {
        decision: chronicler.decision,
        code: chronicler.code,
        kind: chronicler.observability.kind,
        factKey: chronicler.observability.factKey,
        factFingerprint: chronicler.observability.factFingerprint,
        admitted: chronicler.observability.admitted,
        alreadyRemembered: chronicler.observability.alreadyRemembered,
      },
    };
  } catch (error) {
    return {
      status: "failed",
      xPostId: claimed.xPostId,
      perceptionEventId: claimed.perceptionEventId,
      judgementId: claimed.judgementId,
      error: error instanceof Error ? error.message : "authority failed",
    };
  }
}

export async function authorizePendingXPerceptions(
  options: { limit?: number } = {},
  deps: Stage125Deps = {},
): Promise<AuthorizeBatchAggregate> {
  const limit = clampBatchLimit(options.limit);
  const results: AuthorizeOneResult[] = [];
  let authorised = 0;
  let alreadyAuthorised = 0;
  let failed = 0;
  let replyGenerationFailed = 0;

  for (let i = 0; i < limit; i += 1) {
    const one = await authorizeOneXPerception(deps);
    if (one.status === "empty") break;
    results.push(one);
    if (one.status === "authorised") authorised += 1;
    else if (one.status === "already_authorised") alreadyAuthorised += 1;
    else if (one.status === "reply_generation_failed") {
      replyGenerationFailed += 1;
      failed += 1;
    } else if (one.status === "failed") failed += 1;
  }

  return {
    scanned: results.length,
    authorised,
    alreadyAuthorised,
    failed,
    replyGenerationFailed,
    results,
  };
}

export function formatAuthorizeBatchReport(
  agg: AuthorizeBatchAggregate,
): string {
  const lines = [
    "X authority",
    `scanned: ${agg.scanned}`,
    `authorised: ${agg.authorised}`,
    `already_authorised: ${agg.alreadyAuthorised}`,
    `failed: ${agg.failed}`,
    `reply_generation_failed: ${agg.replyGenerationFailed}`,
  ];

  for (const r of agg.results) {
    if (r.status === "failed" || r.status === "reply_generation_failed") {
      lines.push(
        `- ${r.status} x_post_id=${r.xPostId ?? "?"} error=${r.error ?? "?"}` +
          (r.replyRecovery ? ` recovery=${r.replyRecovery}` : ""),
      );
      continue;
    }
    lines.push(
      [
        `- ${r.status}`,
        `x_post_id=${r.xPostId ?? "?"}`,
        `final_action=${r.finalAction ?? "?"}`,
        `outcome=${r.outcome ?? "?"}`,
        `policy_outcome=${r.policyOutcome ?? "?"}`,
        `policy_code=${r.policyCode ?? "?"}`,
        `effects=${r.effectsCreated ?? 0}`,
        r.replyRecovery ? `recovery=${r.replyRecovery}` : null,
        r.chronicler
          ? `chronicler=${r.chronicler.decision}:${r.chronicler.code}`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Stage P1D helpers (live authorize path)
// ---------------------------------------------------------------------------

async function buildLiveEconomicContext(
  claimed: ClaimedAuthorityJudgement,
  admin?: AdminLike,
): Promise<{
  context: NonNullable<
    import("@/lib/agent/authority-policy").AuthorityJudgementInput["economicContext"]
  >;
  overrideEconomicIntent: unknown | null;
}> {
  let purseState = null;
  try {
    const { loadPurseEconomicState } = await import(
      "@/lib/agent/purse-economic-context"
    );
    purseState = await loadPurseEconomicState({ forceTestRail: false });
  } catch {
    purseState = null;
  }

  let interactionConfirmedWallet: string | null = null;
  let economicInteractionId: string | null = null;
  let overrideEconomicIntent: unknown | null = null;

  try {
    const { findActiveEconomicInteractionForAuthor } = await import(
      "@/lib/agent/economic-interaction-persist"
    );
    const active = await findActiveEconomicInteractionForAuthor({
      authorXUserId: claimed.authorXUserId,
      admin: admin as never,
    });
    if (
      active &&
      (active.status === "wallet_confirmed" || active.status === "executing") &&
      active.confirmedWallet &&
      !active.transferEffectId
    ) {
      interactionConfirmedWallet = active.confirmedWallet;
      economicInteractionId = active.id;
      // Frozen original decision — amount never from this perception's user text.
      overrideEconomicIntent = {
        type: "transfer_fenn",
        proposedAmount: active.proposedAmount,
        reason: active.economicReason,
        recipientSource: "trusted_profile_wallet",
      };
    }
  } catch {
    // non-fatal for speech-only paths
  }

  return {
    context: {
      harnessBoundWallet: null,
      interactionConfirmedWallet,
      economicInteractionId,
      executionRail: "official" as const,
      purseState,
      sufficientBalance: purseState ? undefined : false,
    },
    overrideEconomicIntent,
  };
}

async function applyPendingDestinationSideEffects(input: {
  claimed: ClaimedAuthorityJudgement;
  decision: import("@/lib/agent/authority-policy").AuthorityDecision;
  finalReplyText: string | null;
  admin?: AdminLike;
  callWalletSpeechModel?: import("@/lib/agent/wallet-speech").WalletSpeechModelCaller;
  forceWalletSpeechFallback?: boolean;
}): Promise<import("@/lib/agent/authority-policy").AuthorityDecision> {
  const { claimed, decision } = input;
  const { economicIntentFromJson } = await import(
    "@/lib/agent/economic-intent"
  );
  const { createAwaitingWalletInteraction } = await import(
    "@/lib/agent/economic-interaction-persist"
  );
  const { stage12ReplyIdempotencyKey } = await import(
    "@/lib/agent/authority-config"
  );
  const { speechFactsDestinationRequired } = await import(
    "@/lib/agent/wallet-speech-facts"
  );
  const { renderWalletCollectionSpeech } = await import(
    "@/lib/agent/wallet-speech"
  );

  const intent = economicIntentFromJson(claimed.finalEconomicIntent);
  if (intent.type !== "transfer_fenn") {
    return decision;
  }

  await createAwaitingWalletInteraction({
    authorXUserId: claimed.authorXUserId,
    sourceXPostId: claimed.xPostId,
    originPerceptionEventId: claimed.perceptionEventId,
    originJudgementId: claimed.judgementId,
    proposedAmount: intent.proposedAmount,
    economicReason: intent.reason,
    admin: input.admin as never,
  });

  // P1D.1: fact-locked Book of Speech (not raw template overwrite).
  const facts = speechFactsDestinationRequired(intent.proposedAmount);
  const rendered = await renderWalletCollectionSpeech({
    facts,
    untrustedUserBody: claimed.body,
    callModel: input.callWalletSpeechModel,
    forceFallback: input.forceWalletSpeechFallback,
  });
  const ask = rendered.replyText;

  const effects = [...decision.effects];
  const replyIdx = effects.findIndex((e) => e.type === "reply_on_x");
  if (replyIdx >= 0) {
    const prev = effects[replyIdx]!;
    effects[replyIdx] = {
      ...prev,
      payload: {
        ...prev.payload,
        text: ask,
        replyToXPostId: claimed.xPostId,
      },
    };
  } else if (decision.outcome === "permitted" || effects.length > 0) {
    effects.unshift({
      type: "reply_on_x",
      idempotencyKey: stage12ReplyIdempotencyKey(claimed.xPostId),
      payload: {
        replyToXPostId: claimed.xPostId,
        text: ask,
      },
    });
  } else {
    effects.push({
      type: "reply_on_x",
      idempotencyKey: stage12ReplyIdempotencyKey(claimed.xPostId),
      payload: {
        replyToXPostId: claimed.xPostId,
        text: ask,
      },
    });
    return {
      ...decision,
      outcome: "permitted",
      policyCode: "pending_destination",
      finalAction: "reply_on_x",
      effects,
      policyOutcome: "reply_only",
      pendingDestination: true,
      economicSkippedReason: "pending_destination",
    };
  }

  return {
    ...decision,
    outcome: "permitted",
    policyCode: "pending_destination",
    effects,
    pendingDestination: true,
    economicSkippedReason: "pending_destination",
  };
}

async function applyEconomicRefusalAfterConfirm(input: {
  claimed: ClaimedAuthorityJudgement;
  decision: import("@/lib/agent/authority-policy").AuthorityDecision;
  interactionId: string;
  confirmedWallet?: string | null;
  amountFormatted?: string;
  admin?: AdminLike;
  callWalletSpeechModel?: import("@/lib/agent/wallet-speech").WalletSpeechModelCaller;
  forceWalletSpeechFallback?: boolean;
}): Promise<import("@/lib/agent/authority-policy").AuthorityDecision> {
  const {
    mapAuthoritySkippedToRefusalCategory,
    shortWalletForSpeech,
    speechFactsEconomicRefused,
  } = await import("@/lib/agent/wallet-speech-facts");
  const { renderWalletCollectionSpeech } = await import(
    "@/lib/agent/wallet-speech"
  );
  const { markEconomicInteractionFailed } = await import(
    "@/lib/agent/economic-interaction-persist"
  );
  const { stage12ReplyIdempotencyKey } = await import(
    "@/lib/agent/authority-config"
  );

  const reason = input.decision.economicSkippedReason ?? "execution_not_permitted";
  try {
    await markEconomicInteractionFailed({
      interactionId: input.interactionId,
      reason,
      admin: input.admin as never,
    });
  } catch {
    // non-fatal
  }

  const facts = speechFactsEconomicRefused({
    proposedAmount: input.amountFormatted,
    shortWallet: input.confirmedWallet
      ? shortWalletForSpeech(input.confirmedWallet)
      : undefined,
    refusalReason: mapAuthoritySkippedToRefusalCategory(reason),
  });
  const rendered = await renderWalletCollectionSpeech({
    facts,
    untrustedUserBody: input.claimed.body,
    callModel: input.callWalletSpeechModel,
    forceFallback: input.forceWalletSpeechFallback,
  });

  const effects = [...input.decision.effects];
  const replyIdx = effects.findIndex((e) => e.type === "reply_on_x");
  if (replyIdx >= 0) {
    const prev = effects[replyIdx]!;
    effects[replyIdx] = {
      ...prev,
      payload: {
        ...prev.payload,
        text: rendered.replyText,
        replyToXPostId: input.claimed.xPostId,
      },
    };
  } else {
    effects.push({
      type: "reply_on_x",
      idempotencyKey: stage12ReplyIdempotencyKey(input.claimed.xPostId),
      payload: {
        replyToXPostId: input.claimed.xPostId,
        text: rendered.replyText,
      },
    });
  }

  return {
    ...input.decision,
    outcome: "permitted",
    finalAction: "reply_on_x",
    effects,
    policyOutcome: "reply_only",
  };
}

async function maybeLinkEconomicInteractionTransfer(input: {
  decision: import("@/lib/agent/authority-policy").AuthorityDecision;
  admin?: AdminLike;
}): Promise<void> {
  const transfer = input.decision.effects.find((e) => e.type === "transfer_fenn");
  if (!transfer) return;
  const interactionId =
    typeof transfer.payload.economicInteractionId === "string"
      ? transfer.payload.economicInteractionId
      : null;
  if (!interactionId) return;

  try {
    const admin =
      input.admin ??
      ((await import("@/lib/supabase/admin")).createAdminClient() as unknown as AdminLike);
    const effectsTable = admin.from("x_perception_effects") as {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          eq: (
            col2: string,
            val2: string,
          ) => {
            maybeSingle: () => Promise<{
              data: { id: string } | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };

    const { data: effectRow, error } = await effectsTable
      .select("id")
      .eq("idempotency_key", transfer.idempotencyKey)
      .eq("effect_type", "transfer_fenn")
      .maybeSingle();

    if (error || !effectRow?.id) {
      const { updateEconomicInteraction } = await import(
        "@/lib/agent/economic-interaction-persist"
      );
      await updateEconomicInteraction({
        id: interactionId,
        patch: { status: "executing" },
        admin: admin as never,
      });
      return;
    }

    const { tryLinkTransferEffect } = await import(
      "@/lib/agent/economic-interaction-persist"
    );
    await tryLinkTransferEffect({
      interactionId,
      effectId: effectRow.id,
      admin: admin as never,
    });
  } catch {
    // non-fatal — transfer effect may still execute via Stage 12.6
  }
}
