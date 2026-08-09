/**
 * Stage P1D — durable economic interaction persistence (service-role only).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isActiveEconomicInteractionStatus,
  isWalletTurnEconomicInteractionStatus,
  resolveEconomicInteractionTtlMs,
  type EconomicInteractionRow,
  type EconomicInteractionStatus,
} from "@/lib/agent/economic-interaction";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type DbRow = {
  id: string;
  author_x_user_id: string;
  source_x_post_id: string;
  origin_perception_event_id: string | null;
  origin_judgement_id: string | null;
  x_conversation_id: string | null;
  economic_action_type: string;
  proposed_amount: string;
  economic_reason: string;
  status: string;
  candidate_wallet: string | null;
  confirmed_wallet: string | null;
  candidate_source_x_post_id: string | null;
  confirmation_source_x_post_id: string | null;
  transfer_effect_id: string | null;
  last_error: string | null;
  wallet_requested_at: string | null;
  wallet_received_at: string | null;
  wallet_confirmation_requested_at: string | null;
  wallet_confirmed_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

function mapRow(row: DbRow): EconomicInteractionRow {
  return {
    id: String(row.id),
    authorXUserId: String(row.author_x_user_id),
    sourceXPostId: String(row.source_x_post_id),
    originPerceptionEventId:
      row.origin_perception_event_id == null
        ? null
        : String(row.origin_perception_event_id),
    originJudgementId:
      row.origin_judgement_id == null ? null : String(row.origin_judgement_id),
    xConversationId:
      row.x_conversation_id == null ? null : String(row.x_conversation_id),
    economicActionType: "transfer_fenn",
    proposedAmount: String(row.proposed_amount),
    economicReason: String(row.economic_reason),
    status: row.status as EconomicInteractionStatus,
    candidateWallet:
      row.candidate_wallet == null ? null : String(row.candidate_wallet),
    confirmedWallet:
      row.confirmed_wallet == null ? null : String(row.confirmed_wallet),
    candidateSourceXPostId:
      row.candidate_source_x_post_id == null
        ? null
        : String(row.candidate_source_x_post_id),
    confirmationSourceXPostId:
      row.confirmation_source_x_post_id == null
        ? null
        : String(row.confirmation_source_x_post_id),
    transferEffectId:
      row.transfer_effect_id == null ? null : String(row.transfer_effect_id),
    lastError: row.last_error == null ? null : String(row.last_error),
    walletRequestedAt:
      row.wallet_requested_at == null ? null : String(row.wallet_requested_at),
    walletReceivedAt:
      row.wallet_received_at == null ? null : String(row.wallet_received_at),
    walletConfirmationRequestedAt:
      row.wallet_confirmation_requested_at == null
        ? null
        : String(row.wallet_confirmation_requested_at),
    walletConfirmedAt:
      row.wallet_confirmed_at == null ? null : String(row.wallet_confirmed_at),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const SELECT =
  "id, author_x_user_id, source_x_post_id, origin_perception_event_id, origin_judgement_id, x_conversation_id, economic_action_type, proposed_amount, economic_reason, status, candidate_wallet, confirmed_wallet, candidate_source_x_post_id, confirmation_source_x_post_id, transfer_effect_id, last_error, wallet_requested_at, wallet_received_at, wallet_confirmation_requested_at, wallet_confirmed_at, expires_at, created_at, updated_at";

/**
 * Expire stale active rows for one author (or globally if called with no author).
 */
export async function expireStaleEconomicInteractions(input?: {
  authorXUserId?: string;
  now?: Date;
  admin?: SupabaseClient;
}): Promise<number> {
  const db = input?.admin ?? (await defaultAdmin());
  const nowIso = (input?.now ?? new Date()).toISOString();
  let q = db
    .from("x_economic_interactions")
    .update({ status: "expired", last_error: "expired" })
    .in("status", [
      "awaiting_wallet",
      "awaiting_wallet_confirmation",
      "wallet_confirmed",
      "executing",
    ])
    .lt("expires_at", nowIso);
  if (input?.authorXUserId?.trim()) {
    q = q.eq("author_x_user_id", input.authorXUserId.trim());
  }
  const { data, error } = await q.select("id");
  if (error) {
    throw new Error(`economic_interaction_expire_failed:${error.message}`);
  }
  return (data ?? []).length;
}

export async function findActiveEconomicInteractionForAuthor(input: {
  authorXUserId: string;
  admin?: SupabaseClient;
  now?: Date;
}): Promise<EconomicInteractionRow | null> {
  const author = input.authorXUserId.trim();
  if (!author) return null;
  await expireStaleEconomicInteractions({
    authorXUserId: author,
    now: input.now,
    admin: input.admin,
  });

  const db = input.admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("x_economic_interactions")
    .select(SELECT)
    .eq("author_x_user_id", author)
    .in("status", [
      "awaiting_wallet",
      "awaiting_wallet_confirmation",
      "wallet_confirmed",
      "executing",
    ])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`economic_interaction_load_failed:${error.message}`);
  }
  if (!data) return null;
  return mapRow(data as DbRow);
}

export async function findWalletTurnEconomicInteraction(input: {
  authorXUserId: string;
  admin?: SupabaseClient;
  now?: Date;
}): Promise<EconomicInteractionRow | null> {
  const row = await findActiveEconomicInteractionForAuthor(input);
  if (!row) return null;
  if (!isWalletTurnEconomicInteractionStatus(row.status)) return null;
  return row;
}

/**
 * Create awaiting_wallet interaction after authority returns pending_destination.
 * Fail closed if another active flow already exists for this author.
 */
export async function createAwaitingWalletInteraction(input: {
  authorXUserId: string;
  sourceXPostId: string;
  originPerceptionEventId: string;
  originJudgementId?: string | null;
  xConversationId?: string | null;
  proposedAmount: string;
  economicReason: string;
  now?: Date;
  admin?: SupabaseClient;
  ttlMs?: number;
}): Promise<
  | { ok: true; interaction: EconomicInteractionRow; created: true }
  | { ok: false; reason: "active_exists" | "insert_failed"; message?: string }
> {
  const author = input.authorXUserId.trim();
  const existing = await findActiveEconomicInteractionForAuthor({
    authorXUserId: author,
    admin: input.admin,
    now: input.now,
  });
  if (existing && isActiveEconomicInteractionStatus(existing.status)) {
    return { ok: false, reason: "active_exists" };
  }

  const now = input.now ?? new Date();
  const ttl = input.ttlMs ?? resolveEconomicInteractionTtlMs();
  const expiresAt = new Date(now.getTime() + ttl).toISOString();
  const db = input.admin ?? (await defaultAdmin());

  const { data, error } = await db
    .from("x_economic_interactions")
    .insert({
      author_x_user_id: author,
      source_x_post_id: input.sourceXPostId.trim(),
      origin_perception_event_id: input.originPerceptionEventId,
      origin_judgement_id: input.originJudgementId ?? null,
      x_conversation_id: input.xConversationId ?? null,
      economic_action_type: "transfer_fenn",
      proposed_amount: input.proposedAmount.trim(),
      economic_reason: input.economicReason.trim().slice(0, 280),
      status: "awaiting_wallet",
      wallet_requested_at: now.toISOString(),
      expires_at: expiresAt,
    })
    .select(SELECT)
    .single();

  if (error || !data) {
    // Unique index race → treat as active exists
    if (error?.message?.includes("x_economic_interactions_one_active")) {
      return { ok: false, reason: "active_exists" };
    }
    return {
      ok: false,
      reason: "insert_failed",
      message: error?.message,
    };
  }
  return { ok: true, interaction: mapRow(data as DbRow), created: true };
}

export async function updateEconomicInteraction(input: {
  id: string;
  patch: Partial<{
    status: EconomicInteractionStatus;
    candidateWallet: string | null;
    confirmedWallet: string | null;
    candidateSourceXPostId: string | null;
    confirmationSourceXPostId: string | null;
    transferEffectId: string | null;
    lastError: string | null;
    walletRequestedAt: string | null;
    walletReceivedAt: string | null;
    walletConfirmationRequestedAt: string | null;
    walletConfirmedAt: string | null;
  }>;
  admin?: SupabaseClient;
}): Promise<EconomicInteractionRow> {
  const db = input.admin ?? (await defaultAdmin());
  const p = input.patch;
  const row: Record<string, unknown> = {};
  if (p.status !== undefined) row.status = p.status;
  if (p.candidateWallet !== undefined) {
    row.candidate_wallet = p.candidateWallet;
  }
  if (p.confirmedWallet !== undefined) {
    row.confirmed_wallet = p.confirmedWallet;
  }
  if (p.candidateSourceXPostId !== undefined) {
    row.candidate_source_x_post_id = p.candidateSourceXPostId;
  }
  if (p.confirmationSourceXPostId !== undefined) {
    row.confirmation_source_x_post_id = p.confirmationSourceXPostId;
  }
  if (p.transferEffectId !== undefined) {
    row.transfer_effect_id = p.transferEffectId;
  }
  if (p.lastError !== undefined) row.last_error = p.lastError;
  if (p.walletRequestedAt !== undefined) {
    row.wallet_requested_at = p.walletRequestedAt;
  }
  if (p.walletReceivedAt !== undefined) {
    row.wallet_received_at = p.walletReceivedAt;
  }
  if (p.walletConfirmationRequestedAt !== undefined) {
    row.wallet_confirmation_requested_at = p.walletConfirmationRequestedAt;
  }
  if (p.walletConfirmedAt !== undefined) {
    row.wallet_confirmed_at = p.walletConfirmedAt;
  }

  const { data, error } = await db
    .from("x_economic_interactions")
    .update(row)
    .eq("id", input.id)
    .select(SELECT)
    .single();

  if (error || !data) {
    throw new Error(
      `economic_interaction_update_failed:${error?.message ?? "missing"}`,
    );
  }
  return mapRow(data as DbRow);
}

/**
 * Idempotently attach the single transfer effect for an interaction.
 * Returns false if already linked to a different effect.
 */
export async function tryLinkTransferEffect(input: {
  interactionId: string;
  effectId: string;
  admin?: SupabaseClient;
}): Promise<{ linked: boolean; interaction: EconomicInteractionRow }> {
  const db = input.admin ?? (await defaultAdmin());
  const { data: current, error: loadErr } = await db
    .from("x_economic_interactions")
    .select(SELECT)
    .eq("id", input.interactionId)
    .maybeSingle();
  if (loadErr || !current) {
    throw new Error(
      `economic_interaction_link_load_failed:${loadErr?.message ?? "missing"}`,
    );
  }
  const mapped = mapRow(current as DbRow);
  if (mapped.transferEffectId) {
    return {
      linked: mapped.transferEffectId === input.effectId,
      interaction: mapped,
    };
  }

  const { data, error } = await db
    .from("x_economic_interactions")
    .update({
      transfer_effect_id: input.effectId,
      status: "executing",
    })
    .eq("id", input.interactionId)
    .is("transfer_effect_id", null)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(`economic_interaction_link_failed:${error.message}`);
  }
  if (!data) {
    // Concurrent link — re-read
    const again = await db
      .from("x_economic_interactions")
      .select(SELECT)
      .eq("id", input.interactionId)
      .single();
    const row = mapRow(again.data as DbRow);
    return {
      linked: row.transferEffectId === input.effectId,
      interaction: row,
    };
  }
  return { linked: true, interaction: mapRow(data as DbRow) };
}

export async function markEconomicInteractionCompleted(input: {
  interactionId: string;
  admin?: SupabaseClient;
}): Promise<void> {
  await updateEconomicInteraction({
    id: input.interactionId,
    patch: { status: "completed" },
    admin: input.admin,
  });
}

export async function markEconomicInteractionFailed(input: {
  interactionId: string;
  reason: string;
  admin?: SupabaseClient;
}): Promise<void> {
  await updateEconomicInteraction({
    id: input.interactionId,
    patch: { status: "failed", lastError: input.reason.slice(0, 200) },
    admin: input.admin,
  });
}
