import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { LeafError } from "@/lib/leaf/errors";
import type {
  InternalLeafWriteInput,
  LeafLedgerRow,
  LeafMutationResult,
  SafeLeafLedgerEntry,
} from "@/lib/leaf/types";
import { assertSafeIntegerAmount } from "@/lib/leaf/validate";

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "23505" ||
    Boolean(error.message?.toLowerCase().includes("duplicate key"))
  );
}

export function toSafeLeafLedgerEntry(row: LeafLedgerRow): SafeLeafLedgerEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    amount: assertSafeIntegerAmount(row.amount, "amount", "UNSAFE_BIGINT"),
    lifetimeDelta: assertSafeIntegerAmount(
      row.lifetime_delta,
      "lifetime_delta",
      "UNSAFE_BIGINT",
    ),
    sourceType: row.source_type as SafeLeafLedgerEntry["sourceType"],
    sourceId: row.source_id,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

async function loadProfileCaches(
  admin: SupabaseClient,
  profileId: string,
): Promise<{ leafBalance: number; leafLifetimeEarned: number }> {
  const { data, error } = await admin
    .from("profiles")
    .select("leaf_balance, leaf_lifetime_earned")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw new LeafError(
      "LEAF_READ_FAILED",
      "Failed to load profile LEAF caches",
      500,
    );
  }
  if (!data) {
    throw new LeafError("PROFILE_NOT_FOUND", "Profile not found", 404);
  }

  return {
    leafBalance: assertSafeIntegerAmount(
      data.leaf_balance,
      "leaf_balance",
      "UNSAFE_BIGINT",
    ),
    leafLifetimeEarned: assertSafeIntegerAmount(
      data.leaf_lifetime_earned,
      "leaf_lifetime_earned",
      "UNSAFE_BIGINT",
    ),
  };
}

async function findLedgerByIdempotencyKey(
  admin: SupabaseClient,
  idempotencyKey: string,
): Promise<LeafLedgerRow | null> {
  const { data, error } = await admin
    .from("leaf_ledger")
    .select(
      "id, profile_id, wallet_address, amount, lifetime_delta, source_type, source_id, secondary_source_id, reason, actor_type, actor_id, idempotency_key, metadata, created_at",
    )
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new LeafError(
      "LEAF_READ_FAILED",
      "Failed to load ledger by idempotency key",
      500,
    );
  }

  return (data as LeafLedgerRow | null) ?? null;
}

/**
 * Internal LEAF write. Feature code must not import this — use awardLeaf / adminAdjustLeaf.
 */
export async function writeLeafEntry(
  admin: SupabaseClient,
  input: InternalLeafWriteInput,
): Promise<LeafMutationResult> {
  const existing = await findLedgerByIdempotencyKey(admin, input.idempotencyKey);
  if (existing) {
    if (existing.profile_id !== input.profileId) {
      throw new LeafError(
        "LEAF_IDEMPOTENCY_CONFLICT",
        "Idempotency key already used for a different profile",
        409,
      );
    }
    const caches = await loadProfileCaches(admin, input.profileId);
    return {
      created: false,
      entry: toSafeLeafLedgerEntry(existing),
      leafBalance: caches.leafBalance,
      leafLifetimeEarned: caches.leafLifetimeEarned,
    };
  }

  const { data, error } = await admin
    .from("leaf_ledger")
    .insert({
      profile_id: input.profileId,
      wallet_address: input.walletAddress,
      amount: input.amount,
      lifetime_delta: input.lifetimeDelta,
      source_type: input.sourceType,
      source_id: input.sourceId,
      secondary_source_id: input.secondarySourceId,
      reason: input.reason,
      actor_type: input.actorType,
      actor_id: input.actorId,
      idempotency_key: input.idempotencyKey,
      metadata: input.metadata,
    })
    .select(
      "id, profile_id, wallet_address, amount, lifetime_delta, source_type, source_id, secondary_source_id, reason, actor_type, actor_id, idempotency_key, metadata, created_at",
    )
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findLedgerByIdempotencyKey(
        admin,
        input.idempotencyKey,
      );
      if (raced) {
        if (raced.profile_id !== input.profileId) {
          throw new LeafError(
            "LEAF_IDEMPOTENCY_CONFLICT",
            "Idempotency key already used for a different profile",
            409,
          );
        }
        const caches = await loadProfileCaches(admin, input.profileId);
        return {
          created: false,
          entry: toSafeLeafLedgerEntry(raced),
          leafBalance: caches.leafBalance,
          leafLifetimeEarned: caches.leafLifetimeEarned,
        };
      }
    }

    throw new LeafError(
      "LEAF_WRITE_FAILED",
      "Failed to insert leaf_ledger row",
      500,
    );
  }

  const caches = await loadProfileCaches(admin, input.profileId);
  return {
    created: true,
    entry: toSafeLeafLedgerEntry(data as LeafLedgerRow),
    leafBalance: caches.leafBalance,
    leafLifetimeEarned: caches.leafLifetimeEarned,
  };
}

export async function requireProfileWallet(
  admin: SupabaseClient,
  profileId: string,
): Promise<{ id: string; walletAddress: string }> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, wallet_address")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw new LeafError("LEAF_READ_FAILED", "Failed to load profile", 500);
  }
  if (!data) {
    throw new LeafError("PROFILE_NOT_FOUND", "Profile not found", 404);
  }

  return {
    id: data.id as string,
    walletAddress: data.wallet_address as string,
  };
}
