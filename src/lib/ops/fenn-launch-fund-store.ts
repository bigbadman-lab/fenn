/**
 * Durable fen_launch_operations persistence (service_role only).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  FennLaunchFundFailureClass,
  FennLaunchFundStatus,
} from "@/lib/ops/fenn-launch-fund-constants";
import {
  FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
  FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
} from "@/lib/ops/fenn-launch-fund-constants";

export type FennLaunchOperationRow = {
  id: string;
  operationId: string;
  status: FennLaunchFundStatus;
  chainId: number;
  tokenContract: string;
  treasuryAddress: string;
  purseAddress: string;
  amountRaw: string;
  decimals: number;
  amountFormatted: string;
  txHash: string | null;
  blockNumber: string | null;
  failureClass: FennLaunchFundFailureClass | null;
  lastError: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type DbRow = {
  id: string;
  operation_id: string;
  status: string;
  chain_id: number;
  token_contract: string;
  treasury_address: string;
  purse_address: string;
  amount_raw: string;
  decimals: number;
  amount_formatted: string;
  tx_hash: string | null;
  block_number: number | string | null;
  failure_class: string | null;
  last_error: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_COLS =
  "id, operation_id, status, chain_id, token_contract, treasury_address, purse_address, amount_raw, decimals, amount_formatted, tx_hash, block_number, failure_class, last_error, submitted_at, confirmed_at, created_at, updated_at";

function mapRow(row: DbRow): FennLaunchOperationRow {
  return {
    id: String(row.id),
    operationId: String(row.operation_id),
    status: row.status as FennLaunchFundStatus,
    chainId: Number(row.chain_id),
    tokenContract: String(row.token_contract),
    treasuryAddress: String(row.treasury_address),
    purseAddress: String(row.purse_address),
    amountRaw: String(row.amount_raw),
    decimals: Number(row.decimals),
    amountFormatted: String(row.amount_formatted),
    txHash: row.tx_hash == null ? null : String(row.tx_hash),
    blockNumber:
      row.block_number == null ? null : String(row.block_number),
    failureClass: (row.failure_class as FennLaunchFundFailureClass) ?? null,
    lastError: row.last_error == null ? null : String(row.last_error),
    submittedAt: row.submitted_at,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export async function getLaunchOperationById(
  operationId: string = FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
  admin?: SupabaseClient,
): Promise<FennLaunchOperationRow | null> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("fenn_launch_operations")
    .select(SELECT_COLS)
    .eq("operation_id", operationId)
    .maybeSingle();
  if (error) {
    throw new Error(`launch_op_read_failed: ${error.message}`);
  }
  if (!data) return null;
  return mapRow(data as DbRow);
}

/**
 * Insert pending operation for fixed ceremony.
 * On unique conflict, returns existing row (claim lost).
 */
export async function insertPendingLaunchOperation(
  input: {
    chainId: number;
    tokenContract: string;
    treasuryAddress: string;
    purseAddress: string;
    amountRaw: string;
    decimals: number;
    amountFormatted?: string;
    operationId?: string;
  },
  admin?: SupabaseClient,
): Promise<{ created: boolean; row: FennLaunchOperationRow }> {
  const db = admin ?? (await defaultAdmin());
  const operationId =
    input.operationId ?? FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID;
  const amountFormatted =
    input.amountFormatted ?? FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED;

  const { data, error } = await db
    .from("fenn_launch_operations")
    .insert({
      operation_id: operationId,
      status: "pending",
      chain_id: input.chainId,
      token_contract: input.tokenContract,
      treasury_address: input.treasuryAddress,
      purse_address: input.purseAddress,
      amount_raw: input.amountRaw,
      decimals: input.decimals,
      amount_formatted: amountFormatted,
    })
    .select(SELECT_COLS)
    .maybeSingle();

  if (error) {
    if (
      error.message.includes("fenn_launch_operations_operation_id") ||
      error.code === "23505"
    ) {
      const existing = await getLaunchOperationById(operationId, db);
      if (!existing) {
        throw new Error("launch_op_unique_race_missing_row");
      }
      return { created: false, row: existing };
    }
    throw new Error(`launch_op_insert_failed: ${error.message}`);
  }

  if (!data) {
    const existing = await getLaunchOperationById(operationId, db);
    if (existing) return { created: false, row: existing };
    throw new Error("launch_op_insert_empty");
  }

  return { created: true, row: mapRow(data as DbRow) };
}

export async function markLaunchOperationSubmitted(
  input: {
    id: string;
    txHash: string;
    submittedAt: string;
  },
  admin?: SupabaseClient,
): Promise<FennLaunchOperationRow> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("fenn_launch_operations")
    .update({
      status: "submitted",
      tx_hash: input.txHash,
      submitted_at: input.submittedAt,
      failure_class: null,
      last_error: null,
    })
    .eq("id", input.id)
    .select(SELECT_COLS)
    .single();
  if (error || !data) {
    throw new Error(
      `launch_op_submit_failed: ${error?.message ?? "no row"}`,
    );
  }
  return mapRow(data as DbRow);
}

export async function markLaunchOperationConfirmed(
  input: {
    id: string;
    txHash: string;
    confirmedAt: string;
    blockNumber: string | null;
    submittedAt?: string | null;
  },
  admin?: SupabaseClient,
): Promise<FennLaunchOperationRow> {
  const db = admin ?? (await defaultAdmin());
  const patch: Record<string, unknown> = {
    status: "confirmed",
    tx_hash: input.txHash,
    confirmed_at: input.confirmedAt,
    block_number: input.blockNumber == null ? null : Number(input.blockNumber),
    failure_class: null,
    last_error: null,
  };
  if (input.submittedAt != null) {
    patch.submitted_at = input.submittedAt;
  }
  const { data, error } = await db
    .from("fenn_launch_operations")
    .update(patch)
    .eq("id", input.id)
    .select(SELECT_COLS)
    .single();
  if (error || !data) {
    throw new Error(
      `launch_op_confirm_failed: ${error?.message ?? "no row"}`,
    );
  }
  return mapRow(data as DbRow);
}

export async function markLaunchOperationFailed(
  input: {
    id: string;
    failureClass: FennLaunchFundFailureClass;
    lastError: string;
    status?: "failed" | "ambiguous";
    txHash?: string | null;
  },
  admin?: SupabaseClient,
): Promise<FennLaunchOperationRow> {
  const db = admin ?? (await defaultAdmin());
  const status = input.status ?? "failed";
  const patch: Record<string, unknown> = {
    status,
    failure_class: input.failureClass,
    last_error: input.lastError.slice(0, 500),
  };
  if (input.txHash !== undefined) {
    patch.tx_hash = input.txHash;
  }
  const { data, error } = await db
    .from("fenn_launch_operations")
    .update(patch)
    .eq("id", input.id)
    .select(SELECT_COLS)
    .single();
  if (error || !data) {
    throw new Error(
      `launch_op_fail_failed: ${error?.message ?? "no row"}`,
    );
  }
  return mapRow(data as DbRow);
}

/** Reset a pre_broadcast failed op to pending for a controlled retry. */
export async function resetLaunchOperationForRetry(
  id: string,
  admin?: SupabaseClient,
): Promise<FennLaunchOperationRow> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("fenn_launch_operations")
    .update({
      status: "pending",
      tx_hash: null,
      submitted_at: null,
      confirmed_at: null,
      block_number: null,
      failure_class: null,
      last_error: null,
    })
    .eq("id", id)
    .eq("status", "failed")
    .eq("failure_class", "pre_broadcast")
    .select(SELECT_COLS)
    .maybeSingle();
  if (error) {
    throw new Error(`launch_op_reset_failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("launch_op_reset_not_eligible");
  }
  return mapRow(data as DbRow);
}
