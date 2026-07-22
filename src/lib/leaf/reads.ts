import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { LeafError } from "@/lib/leaf/errors";
import type {
  LeafHistoryOptions,
  LeafHistoryPage,
  LeafLedgerRow,
  LeafReconciliationResult,
  SafeLeafLedgerEntry,
} from "@/lib/leaf/types";
import {
  assertProfileId,
  assertSafeIntegerAmount,
  parseHistoryLimit,
} from "@/lib/leaf/validate";
import { toSafeLeafLedgerEntry } from "@/lib/leaf/write";

async function loadProfileLeafCaches(profileId: string): Promise<{
  leafBalance: number;
  leafLifetimeEarned: number;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("leaf_balance, leaf_lifetime_earned")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw new LeafError("LEAF_READ_FAILED", "Failed to load LEAF caches", 500);
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

export async function getLeafBalance(profileId: string): Promise<number> {
  const id = assertProfileId(profileId);
  const caches = await loadProfileLeafCaches(id);
  return caches.leafBalance;
}

export async function getLeafLifetimeEarned(
  profileId: string,
): Promise<number> {
  const id = assertProfileId(profileId);
  const caches = await loadProfileLeafCaches(id);
  return caches.leafLifetimeEarned;
}

/**
 * Cursor pagination: ORDER BY created_at DESC, id DESC.
 * Pass nextCursor from a previous page to continue.
 */
export async function getLeafHistory(
  profileId: string,
  options: LeafHistoryOptions = {},
): Promise<LeafHistoryPage> {
  const id = assertProfileId(profileId);
  const limit = parseHistoryLimit(options.limit);
  const admin = createAdminClient();

  let query = admin
    .from("leaf_ledger")
    .select(
      "id, profile_id, wallet_address, amount, lifetime_delta, source_type, source_id, secondary_source_id, reason, actor_type, actor_id, idempotency_key, metadata, created_at",
    )
    .eq("profile_id", id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (options.cursor?.createdAt && options.cursor?.id) {
    const createdAt = options.cursor.createdAt;
    const cursorId = options.cursor.id;
    // PostgREST: rows older than (created_at, id) under DESC ordering.
    query = query.or(
      `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${cursorId})`,
    );
  }

  const { data, error } = await query;

  if (error) {
    throw new LeafError("LEAF_READ_FAILED", "Failed to load LEAF history", 500);
  }

  const rows = (data as LeafLedgerRow[] | null) ?? [];
  const pageRows = rows.slice(0, limit);
  const entries: SafeLeafLedgerEntry[] = pageRows.map(toSafeLeafLedgerEntry);

  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? { createdAt: last.created_at, id: last.id }
      : null;

  return { entries, nextCursor };
}

/**
 * Diagnostic only — does not mutate caches.
 */
export async function reconcileLeafCaches(
  profileId: string,
): Promise<LeafReconciliationResult> {
  const id = assertProfileId(profileId);
  const admin = createAdminClient();

  const caches = await loadProfileLeafCaches(id);

  const { data, error } = await admin
    .from("leaf_ledger")
    .select("amount, lifetime_delta")
    .eq("profile_id", id);

  if (error) {
    throw new LeafError(
      "LEAF_READ_FAILED",
      "Failed to load ledger for reconciliation",
      500,
    );
  }

  let amountSum = 0;
  let lifetimeDeltaSum = 0;

  for (const row of data ?? []) {
    const amount = assertSafeIntegerAmount(
      row.amount,
      "amount",
      "UNSAFE_BIGINT",
    );
    const lifetimeDelta = assertSafeIntegerAmount(
      row.lifetime_delta,
      "lifetime_delta",
      "UNSAFE_BIGINT",
    );

    // Reject if running sum would leave safe integer range.
    if (
      !Number.isSafeInteger(amountSum + amount) ||
      !Number.isSafeInteger(lifetimeDeltaSum + lifetimeDelta)
    ) {
      throw new LeafError(
        "UNSAFE_BIGINT",
        "Ledger sum exceeds safe integer range",
        500,
      );
    }

    amountSum += amount;
    lifetimeDeltaSum += lifetimeDelta;
  }

  return {
    profileId: id,
    cache: {
      leafBalance: caches.leafBalance,
      leafLifetimeEarned: caches.leafLifetimeEarned,
    },
    ledger: {
      amountSum,
      lifetimeDeltaSum,
    },
    matches:
      amountSum === caches.leafBalance &&
      lifetimeDeltaSum === caches.leafLifetimeEarned,
  };
}
