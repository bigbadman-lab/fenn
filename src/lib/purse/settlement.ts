import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type PurseFailureClass,
  type PurseTransferStatus,
} from "@/lib/purse/constants";
import { PurseError } from "@/lib/purse/errors";
import type { PurseTransferRow } from "@/lib/purse/types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

const TRANSFER_SELECT =
  "id, operation_id, recipient_address, amount_raw, amount_formatted, token_address, chain_id, tx_hash, status, failure_class, last_error, actor_id, is_test, created_at, submitted_at, confirmed_at";

type TransferDbRow = {
  id: string;
  operation_id: string;
  recipient_address: string;
  amount_raw: string;
  amount_formatted: string;
  token_address: string;
  chain_id: number;
  tx_hash: string | null;
  status: string;
  failure_class: string | null;
  last_error: string | null;
  actor_id: string | null;
  is_test?: boolean | null;
  created_at: string;
  submitted_at: string | null;
  confirmed_at: string | null;
};

function mapRow(row: TransferDbRow): PurseTransferRow {
  return {
    id: String(row.id),
    operationId: String(row.operation_id),
    recipientAddress: String(row.recipient_address),
    amountRaw: String(row.amount_raw),
    amountFormatted: String(row.amount_formatted),
    tokenAddress: String(row.token_address),
    chainId: Number(row.chain_id),
    txHash: row.tx_hash == null ? null : String(row.tx_hash),
    status: row.status as PurseTransferStatus,
    failureClass:
      row.failure_class == null
        ? null
        : (row.failure_class as PurseFailureClass),
    lastError: row.last_error == null ? null : String(row.last_error),
    actorId: row.actor_id == null ? null : String(row.actor_id),
    isTest: Boolean(row.is_test),
    createdAt: String(row.created_at),
    submittedAt: row.submitted_at == null ? null : String(row.submitted_at),
    confirmedAt: row.confirmed_at == null ? null : String(row.confirmed_at),
  };
}

export async function getPurseTransferByOperationId(
  operationId: string,
  admin?: SupabaseClient,
): Promise<PurseTransferRow | null> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("purse_transfers")
    .select(TRANSFER_SELECT)
    .eq("operation_id", operationId)
    .maybeSingle();

  if (error) {
    throw new PurseError(
      "purse_settlement_failed",
      "Failed to load Purse settlement",
      500,
    );
  }
  if (!data) return null;
  return mapRow(data as TransferDbRow);
}

export async function insertPendingPurseTransfer(
  input: {
    operationId: string;
    recipientAddress: string;
    amountRaw: string;
    amountFormatted: string;
    tokenAddress: string;
    chainId: number;
    actorId: string;
    isTest?: boolean;
  },
  admin?: SupabaseClient,
): Promise<PurseTransferRow> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("purse_transfers")
    .insert({
      operation_id: input.operationId,
      recipient_address: input.recipientAddress,
      amount_raw: input.amountRaw,
      amount_formatted: input.amountFormatted,
      token_address: input.tokenAddress,
      chain_id: input.chainId,
      status: "pending",
      actor_id: input.actorId,
      is_test: Boolean(input.isTest),
    })
    .select(TRANSFER_SELECT)
    .single();

  if (error) {
    // Unique race: another writer created the same operation_id.
    if (
      typeof error.message === "string" &&
      (error.message.includes("purse_transfers_operation_id") ||
        error.code === "23505")
    ) {
      const existing = await getPurseTransferByOperationId(
        input.operationId,
        db,
      );
      if (existing) return existing;
    }
    throw new PurseError(
      "purse_settlement_failed",
      "Failed to create Purse settlement",
      500,
    );
  }

  return mapRow(data as TransferDbRow);
}

export async function markPurseTransferSubmitted(
  input: {
    id: string;
    txHash: string;
    submittedAt: string;
  },
  admin?: SupabaseClient,
): Promise<PurseTransferRow> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("purse_transfers")
    .update({
      status: "submitted",
      tx_hash: input.txHash,
      submitted_at: input.submittedAt,
      failure_class: null,
      last_error: null,
    })
    .eq("id", input.id)
    .select(TRANSFER_SELECT)
    .single();

  if (error) {
    throw new PurseError(
      "purse_settlement_failed",
      "Failed to mark Purse transfer submitted",
      500,
    );
  }
  return mapRow(data as TransferDbRow);
}

export async function markPurseTransferConfirmed(
  input: {
    id: string;
    txHash: string;
    confirmedAt: string;
    submittedAt?: string | null;
  },
  admin?: SupabaseClient,
): Promise<PurseTransferRow> {
  const db = admin ?? (await defaultAdmin());
  const patch: Record<string, unknown> = {
    status: "confirmed",
    tx_hash: input.txHash,
    confirmed_at: input.confirmedAt,
    failure_class: null,
    last_error: null,
  };
  if (input.submittedAt) {
    patch.submitted_at = input.submittedAt;
  }

  const { data, error } = await db
    .from("purse_transfers")
    .update(patch)
    .eq("id", input.id)
    .select(TRANSFER_SELECT)
    .single();

  if (error) {
    throw new PurseError(
      "purse_settlement_failed",
      "Failed to mark Purse transfer confirmed",
      500,
    );
  }
  return mapRow(data as TransferDbRow);
}

export async function markPurseTransferFailed(
  input: {
    id: string;
    failureClass: PurseFailureClass;
    lastError: string;
    /** Only set when a hash is already known (usually ambiguous path). */
    txHash?: string | null;
    status?: "failed" | "ambiguous";
  },
  admin?: SupabaseClient,
): Promise<PurseTransferRow> {
  const db = admin ?? (await defaultAdmin());
  const status =
    input.status ??
    (input.failureClass === "ambiguous" ? "ambiguous" : "failed");

  const patch: Record<string, unknown> = {
    status,
    failure_class: input.failureClass,
    last_error: input.lastError.slice(0, 500),
  };
  if (input.txHash) {
    patch.tx_hash = input.txHash;
  }

  const { data, error } = await db
    .from("purse_transfers")
    .update(patch)
    .eq("id", input.id)
    .select(TRANSFER_SELECT)
    .single();

  if (error) {
    throw new PurseError(
      "purse_settlement_failed",
      "Failed to mark Purse transfer failed",
      500,
    );
  }
  return mapRow(data as TransferDbRow);
}

/**
 * Reset a pre_broadcast failed row so the same operation may try again.
 */
export async function resetPurseTransferForRetry(
  id: string,
  admin?: SupabaseClient,
): Promise<PurseTransferRow> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("purse_transfers")
    .update({
      status: "pending",
      failure_class: null,
      last_error: null,
      tx_hash: null,
      submitted_at: null,
      confirmed_at: null,
    })
    .eq("id", id)
    .select(TRANSFER_SELECT)
    .single();

  if (error) {
    throw new PurseError(
      "purse_settlement_failed",
      "Failed to reset Purse transfer for retry",
      500,
    );
  }
  return mapRow(data as TransferDbRow);
}

export async function tryAcquirePurseTransferLock(
  admin?: SupabaseClient,
): Promise<boolean> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db.rpc("try_acquire_purse_transfer_lock");
  if (error) {
    throw new PurseError(
      "purse_settlement_failed",
      "Failed to acquire Purse transfer lock",
      500,
    );
  }
  return data === true;
}

export async function releasePurseTransferLock(
  admin?: SupabaseClient,
): Promise<void> {
  const db = admin ?? (await defaultAdmin());
  const { error } = await db.rpc("release_purse_transfer_lock");
  if (error) {
    console.error("[purse] failed to release transfer lock", error.message);
  }
}
