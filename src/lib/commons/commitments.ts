import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  toPublicCommonsAllocationDelta,
  toPublicCommonsCommitment,
} from "@/lib/commons/dto";
import { CommonsError } from "@/lib/commons/errors";
import type {
  PublicCommonsAllocationDelta,
  PublicCommonsCommitment,
} from "@/lib/commons/types";

/** Public MVP history window — newest first. */
export const PUBLIC_COMMONS_ALLOCATION_HISTORY_LIMIT = 50;

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Current Commons commitments from `commons_commitments.amount`.
 * Empty array is a valid known-empty state.
 * Ordered by asset_symbol ascending (deterministic).
 * Does NOT reconstruct amounts from allocation deltas.
 */
export async function getCommonsCommitments(
  admin?: SupabaseClient,
): Promise<PublicCommonsCommitment[]> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("commons_commitments")
    .select("asset_symbol, amount, value_usd_manual")
    .order("asset_symbol", { ascending: true });

  if (error) {
    throw new CommonsError(
      "commons_read_failed",
      "Failed to load Commons commitments",
      500,
    );
  }

  return (data ?? []).map((row) =>
    toPublicCommonsCommitment(
      row as {
        asset_symbol: string;
        amount: unknown;
        value_usd_manual: unknown;
      },
    ),
  );
}

/**
 * Commitment-change audit history (not Circulations / payments).
 * Newest first. Default public limit: PUBLIC_COMMONS_ALLOCATION_HISTORY_LIMIT.
 */
export async function getCommonsAllocationHistory(
  admin?: SupabaseClient,
  limit = PUBLIC_COMMONS_ALLOCATION_HISTORY_LIMIT,
): Promise<PublicCommonsAllocationDelta[]> {
  const db = admin ?? (await defaultAdmin());
  const pageSize = Math.min(
    Math.max(1, limit),
    PUBLIC_COMMONS_ALLOCATION_HISTORY_LIMIT,
  );
  const { data, error } = await db
    .from("commons_allocations")
    .select(
      "id, asset_symbol, delta_amount, reason, related_contribution_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(pageSize);

  if (error) {
    throw new CommonsError(
      "commons_read_failed",
      "Failed to load Commons allocation history",
      500,
    );
  }

  return (data ?? []).map((row) =>
    toPublicCommonsAllocationDelta(
      row as {
        id: string;
        asset_symbol: string;
        delta_amount: unknown;
        reason: string;
        related_contribution_id: string | null;
        created_at: string;
      },
    ),
  );
}
