/**
 * Stage P1E — plan + optionally persist post-confirmation reply_on_x effect.
 *
 * Stage 12.6 posts the follow-up via existing X OAuth path.
 * Purse runtime does not need X credentials for the plan step to succeed;
 * persist happens in the agent executor after settlement confirms.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  allowTestEconomicFollowupX,
  buildEconomicCompletionFacts,
  stage12EconomicFollowupReplyIdempotencyKey,
  type EconomicCompletionFacts,
} from "@/lib/agent/economic-followup";
import {
  renderEconomicCompletionSpeech,
  type EconomicCompletionSpeechModelCaller,
  type EconomicCompletionSpeechResult,
} from "@/lib/agent/economic-completion-speech";

export type EconomicCompletionPlanResult = {
  ok: boolean;
  facts: EconomicCompletionFacts | null;
  speech: EconomicCompletionSpeechResult | null;
  idempotencyKey: string | null;
  replyEffectPlanned: boolean;
  replyEffectPersisted: boolean;
  replyEffectId: string | null;
  skippedReason: string | null;
  /**
   * Conversation-preferred thread post (e.g. wallet confirmation) when available.
   * Stage 12.6 still requires reply payload target == perception event x_post_id.
   */
  preferredThreadXPostId: string | null;
};

type AdminLike = {
  from: (table: string) => unknown;
};

async function resolveReplyToXPostId(input: {
  sourceXPostId: string;
  economicInteractionId?: string | null;
  admin?: SupabaseClient | AdminLike;
}): Promise<string> {
  const fallback = input.sourceXPostId.trim();
  const ixId = input.economicInteractionId?.trim();
  if (!ixId || !input.admin) return fallback;
  try {
    const db = input.admin as SupabaseClient;
    const { data } = await db
      .from("x_economic_interactions")
      .select("confirmation_source_x_post_id, source_x_post_id")
      .eq("id", ixId)
      .maybeSingle();
    if (data && typeof data === "object") {
      const conf =
        typeof (data as { confirmation_source_x_post_id?: string })
          .confirmation_source_x_post_id === "string"
          ? (data as { confirmation_source_x_post_id: string })
              .confirmation_source_x_post_id.trim()
          : "";
      if (conf) return conf;
      const src =
        typeof (data as { source_x_post_id?: string }).source_x_post_id ===
        "string"
          ? (data as { source_x_post_id: string }).source_x_post_id.trim()
          : "";
      if (src) return src;
    }
  } catch {
    // keep fallback
  }
  return fallback;
}

/**
 * After confirmed settlement: generate speech + optional durable reply effect.
 *
 * Does not post to X. Does not require confirmationStatus string when the adapter
 * already returned ok (confirmed) — callers must only invoke post-confirm.
 */
export async function planEconomicCompletionFollowup(input: {
  actionType: "transfer" | "burn";
  amountFormatted: string;
  txHash: string;
  confirmedAt: string;
  isTest: boolean;
  economicEffectId: string;
  /** Perception event's X post id (claim.xPostId) — must match effect perception. */
  sourceXPostId: string;
  authorizationId: string;
  perceptionEventId: string;
  recipientAddress?: string | null;
  economicInteractionId?: string | null;
  /** When true, build speech but never insert reply_on_x. */
  dryRun?: boolean;
  /** Force skip DB insert (tests). */
  skipPersist?: boolean;
  admin?: SupabaseClient | AdminLike;
  callSpeechModel?: EconomicCompletionSpeechModelCaller;
  forceSpeechFallback?: boolean;
}): Promise<EconomicCompletionPlanResult> {
  const idempotencyKey = stage12EconomicFollowupReplyIdempotencyKey(
    input.economicEffectId,
  );

  if (!input.txHash?.trim() || !input.confirmedAt?.trim()) {
    return {
      ok: false,
      facts: null,
      speech: null,
      idempotencyKey,
      replyEffectPlanned: false,
      replyEffectPersisted: false,
      replyEffectId: null,
      skippedReason: "not_confirmed",
      preferredThreadXPostId: null,
    };
  }

  const preferredThreadXPostId = await resolveReplyToXPostId({
    sourceXPostId: input.sourceXPostId,
    economicInteractionId: input.economicInteractionId,
    admin: input.admin,
  });

  // Stage 12.6 validateReplyEffectPayload requires reply target == perception
  // event x_post_id (claimed.xPostId). After wallet confirm, that post is usually
  // the confirmation turn; for burns it is the originating judgement post.
  const replyTarget = input.sourceXPostId.trim();
  const facts = buildEconomicCompletionFacts({
    actionType: input.actionType,
    amountFormatted: input.amountFormatted,
    txHash: input.txHash,
    confirmedAt: input.confirmedAt,
    isTest: input.isTest,
    economicEffectId: input.economicEffectId,
    replyToXPostId: replyTarget,
    recipientAddress: input.recipientAddress,
  });

  if (!facts) {
    return {
      ok: false,
      facts: null,
      speech: null,
      idempotencyKey,
      replyEffectPlanned: false,
      replyEffectPersisted: false,
      replyEffectId: null,
      skippedReason: "facts_incomplete",
      preferredThreadXPostId,
    };
  }

  const speech = await renderEconomicCompletionSpeech({
    facts,
    callModel: input.callSpeechModel,
    forceFallback: input.forceSpeechFallback,
  });

  const planned = true;
  let replyEffectPersisted = false;
  let replyEffectId: string | null = null;

  const shouldPersist =
    !input.dryRun &&
    !input.skipPersist &&
    (!facts.isTest || allowTestEconomicFollowupX());

  if (!shouldPersist) {
    return {
      ok: true,
      facts,
      speech,
      idempotencyKey,
      replyEffectPlanned: planned,
      replyEffectPersisted: false,
      replyEffectId: null,
      // Prefer explicit dry-run over test-rail suppress (both do not persist).
      skippedReason: input.dryRun
        ? "dry_run"
        : facts.isTest
          ? "test_followup_x_suppressed"
          : "skip_persist",
      preferredThreadXPostId,
    };
  }

  try {
    const admin =
      input.admin ??
      ((await import("@/lib/supabase/admin")).createAdminClient() as SupabaseClient);

    const row = {
      authorization_id: input.authorizationId,
      perception_event_id: input.perceptionEventId,
      effect_type: "reply_on_x",
      idempotency_key: idempotencyKey,
      payload: {
        replyToXPostId: replyTarget,
        text: speech.replyText,
        economicFollowupOfEffectId: input.economicEffectId,
        economicActionType: facts.actionType,
        preferredThreadXPostId,
      },
      status: "pending",
    };

    const { data, error } = await (admin as SupabaseClient)
      .from("x_perception_effects")
      .insert(row)
      .select("id")
      .maybeSingle();

    if (error) {
      // Unique violation → already planned
      if (
        error.message?.includes("duplicate") ||
        error.message?.includes("unique") ||
        error.code === "23505"
      ) {
        const existing = await (admin as SupabaseClient)
          .from("x_perception_effects")
          .select("id")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        return {
          ok: true,
          facts,
          speech,
          idempotencyKey,
          replyEffectPlanned: true,
          replyEffectPersisted: Boolean(existing.data?.id),
          replyEffectId:
            typeof existing.data?.id === "string" ? existing.data.id : null,
          skippedReason: "already_exists",
          preferredThreadXPostId,
        };
      }
      console.warn("[p1e-economic-completion] persist_failed", error.message);
      return {
        ok: true,
        facts,
        speech,
        idempotencyKey,
        replyEffectPlanned: true,
        replyEffectPersisted: false,
        replyEffectId: null,
        skippedReason: `persist_failed:${error.message}`,
        preferredThreadXPostId,
      };
    }

    replyEffectPersisted = true;
    replyEffectId = typeof data?.id === "string" ? data.id : null;
  } catch (error) {
    console.warn(
      "[p1e-economic-completion] persist_exception",
      error instanceof Error ? error.message : error,
    );
  }

  return {
    ok: true,
    facts,
    speech,
    idempotencyKey,
    replyEffectPlanned: planned,
    replyEffectPersisted,
    replyEffectId,
    skippedReason: replyEffectPersisted ? null : "persist_unavailable",
    preferredThreadXPostId,
  };
}
