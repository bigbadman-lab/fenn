import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { LeafError } from "@/lib/leaf/errors";
import type {
  AdminAdjustLeafInput,
  LeafLedgerRow,
  LeafMutationResult,
} from "@/lib/leaf/types";
import {
  assertActorId,
  assertIdempotencyKey,
  assertLifetimeDelta,
  assertMetadata,
  assertNonZeroAdjustAmount,
  assertOptionalSourceId,
  assertProfileId,
  assertReason,
  assertSafeIntegerAmount,
} from "@/lib/leaf/validate";
import { toSafeLeafLedgerEntry } from "@/lib/leaf/write";

type AdminAdjustRpcRow = {
  created: boolean;
  ledger_id: string;
  profile_id: string;
  amount: number | string;
  lifetime_delta: number | string;
  source_type: string;
  source_id: string | null;
  reason: string;
  created_at: string;
  leaf_balance: number | string;
  leaf_lifetime_earned: number | string;
};

/**
 * Privileged LEAF adjustment with atomic admin_audit_log via admin_adjust_leaf RPC.
 * No browser access. Future admin auth must gate this in trusted server code.
 */
export async function adminAdjustLeaf(
  input: AdminAdjustLeafInput,
): Promise<LeafMutationResult> {
  const profileId = assertProfileId(input.profileId);
  const amount = assertNonZeroAdjustAmount(input.amount);
  const lifetimeDelta = assertLifetimeDelta(input.lifetimeDelta);
  const reason = assertReason(input.reason);
  const actorId = assertActorId(input.actorId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const metadata = assertMetadata(input.metadata);
  const sourceId = assertOptionalSourceId(input.sourceId);
  const secondarySourceId = assertOptionalSourceId(input.secondarySourceId);

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("admin_adjust_leaf", {
    p_profile_id: profileId,
    p_amount: amount,
    p_lifetime_delta: lifetimeDelta,
    p_reason: reason,
    p_actor_id: actorId,
    p_idempotency_key: idempotencyKey,
    p_metadata: metadata,
    p_source_id: sourceId,
    p_secondary_source_id: secondarySourceId,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("FENN_PROFILE_NOT_FOUND")) {
      throw new LeafError("PROFILE_NOT_FOUND", "Profile not found", 404);
    }
    if (message.includes("FENN_VALIDATION:")) {
      if (message.includes("lifetime")) {
        throw new LeafError(
          "INVALID_LIFETIME_DELTA",
          "lifetimeDelta would violate constraints",
        );
      }
      if (message.includes("amount")) {
        throw new LeafError("INVALID_AMOUNT", "Invalid adjustment amount");
      }
      throw new LeafError("INVALID_AMOUNT", "Invalid admin adjustment");
    }
    if (message.includes("FENN_IDEMPOTENCY_CONFLICT")) {
      throw new LeafError(
        "LEAF_IDEMPOTENCY_CONFLICT",
        "Idempotency key conflict",
        409,
      );
    }

    throw new LeafError(
      "LEAF_AUDIT_FAILED",
      "Admin LEAF adjustment failed",
      500,
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | AdminAdjustRpcRow
    | undefined;

  if (!row) {
    throw new LeafError(
      "LEAF_AUDIT_FAILED",
      "Admin LEAF adjustment returned no row",
      500,
    );
  }

  const entry: LeafLedgerRow = {
    id: row.ledger_id,
    profile_id: row.profile_id,
    wallet_address: "",
    amount: row.amount,
    lifetime_delta: row.lifetime_delta,
    source_type: row.source_type,
    source_id: row.source_id,
    secondary_source_id: null,
    reason: row.reason,
    actor_type: "admin",
    actor_id: actorId,
    idempotency_key: idempotencyKey,
    metadata,
    created_at: row.created_at,
  };

  return {
    created: Boolean(row.created),
    entry: toSafeLeafLedgerEntry(entry),
    leafBalance: assertSafeIntegerAmount(
      row.leaf_balance,
      "leaf_balance",
      "UNSAFE_BIGINT",
    ),
    leafLifetimeEarned: assertSafeIntegerAmount(
      row.leaf_lifetime_earned,
      "leaf_lifetime_earned",
      "UNSAFE_BIGINT",
    ),
  };
}
