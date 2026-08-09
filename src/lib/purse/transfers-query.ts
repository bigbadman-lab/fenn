import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { PUBLIC_PURSE_TRANSFER_HISTORY_LIMIT } from "@/lib/purse/constants";
import { PurseError } from "@/lib/purse/errors";
import type { PublicPurseTransfer } from "@/lib/purse/types";
import { explorerTxUrl } from "@/lib/greenwood/hollow/explorer";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type ConfirmedRow = {
  id: string;
  operation_id: string;
  recipient_address: string;
  amount_formatted: string;
  token_address: string;
  chain_id: number;
  tx_hash: string;
  confirmed_at: string;
  action_type?: string | null;
};

/**
 * Confirmed outbound history only — never pending/failed/ambiguous.
 * Safe for public Commons. No private keys, no internal error text.
 */
export async function listConfirmedPurseTransfers(
  limit: number = PUBLIC_PURSE_TRANSFER_HISTORY_LIMIT,
  admin?: SupabaseClient,
): Promise<PublicPurseTransfer[]> {
  const db = admin ?? (await defaultAdmin());
  const capped = Math.min(
    Math.max(1, Math.floor(limit)),
    PUBLIC_PURSE_TRANSFER_HISTORY_LIMIT,
  );

  const { data, error } = await db
    .from("purse_transfers")
    .select(
      "id, operation_id, recipient_address, amount_formatted, token_address, chain_id, tx_hash, confirmed_at, action_type",
    )
    .eq("status", "confirmed")
    .eq("is_test", false)
    .not("tx_hash", "is", null)
    .not("confirmed_at", "is", null)
    .order("confirmed_at", { ascending: false })
    .limit(capped);

  if (error) {
    throw new PurseError(
      "purse_read_failed",
      "Failed to load confirmed Purse transfers",
      500,
    );
  }

  return (data ?? []).map((row) => {
    const r = row as ConfirmedRow;
    const chainId = Number(r.chain_id);
    const txHash = String(r.tx_hash);
    return {
      id: String(r.id),
      operationId: String(r.operation_id),
      recipientAddress: String(r.recipient_address),
      amountFormatted: String(r.amount_formatted),
      tokenAddress: String(r.token_address),
      chainId,
      txHash,
      confirmedAt: String(r.confirmed_at),
      explorerTxUrl: explorerTxUrl(chainId, txHash),
      actionType: r.action_type === "burn" ? "burn" : "transfer",
    };
  });
}

type HistoryAggRow = {
  amount_raw: string;
  amount_formatted: string;
  action_type?: string | null;
  confirmed_at: string;
};

export type PurseEconomicHistoryStats = {
  totalTransferredFormatted: string;
  totalBurnedFormatted: string;
  largestTransferFormatted: string | null;
  largestBurnFormatted: string | null;
  rolling24hOutflowFormatted: string;
  confirmedTransferCount: number;
  confirmedBurnCount: number;
};

/**
 * Compact trusted economy history for Stage P1C authority / prompt context.
 * Uses integer raw units for sums — never JS float.
 * Official path: is_test=false. Test harness: include test rows only when asked.
 */
export async function loadPurseEconomicHistoryStats(input?: {
  includeTest?: boolean;
  now?: Date;
  admin?: SupabaseClient;
  /** Trusted decimals for re-formatting raw sums (default 18). */
  decimals?: number;
}): Promise<PurseEconomicHistoryStats> {
  const { formatRawToDecimalString } = await import(
    "@/lib/agent/economic-amount"
  );
  const db = input?.admin ?? (await defaultAdmin());
  const decimals = input?.decimals ?? 18;
  const now = input?.now ?? new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  let query = db
    .from("purse_transfers")
    .select("amount_raw, amount_formatted, action_type, confirmed_at")
    .eq("status", "confirmed")
    .not("tx_hash", "is", null)
    .not("confirmed_at", "is", null)
    .order("confirmed_at", { ascending: false })
    .limit(500);

  if (input?.includeTest) {
    query = query.eq("is_test", true);
  } else {
    query = query.eq("is_test", false);
  }

  const { data, error } = await query;
  if (error) {
    throw new PurseError(
      "purse_read_failed",
      "Failed to load Purse economic history",
      500,
    );
  }

  let transferRaw = BigInt(0);
  let burnRaw = BigInt(0);
  let rollingRaw = BigInt(0);
  let largestTransferRaw = BigInt(0);
  let largestBurnRaw = BigInt(0);
  let transferCount = 0;
  let burnCount = 0;

  for (const row of data ?? []) {
    const r = row as HistoryAggRow;
    let raw: bigint;
    try {
      raw = BigInt(String(r.amount_raw));
    } catch {
      continue;
    }
    if (raw < BigInt(0)) continue;
    const isBurn = r.action_type === "burn";
    if (isBurn) {
      burnCount += 1;
      burnRaw += raw;
      if (raw > largestBurnRaw) largestBurnRaw = raw;
    } else {
      transferCount += 1;
      transferRaw += raw;
      if (raw > largestTransferRaw) largestTransferRaw = raw;
    }
    if (String(r.confirmed_at) >= windowStart) {
      rollingRaw += raw;
    }
  }

  return {
    totalTransferredFormatted: formatRawToDecimalString(transferRaw, decimals),
    totalBurnedFormatted: formatRawToDecimalString(burnRaw, decimals),
    largestTransferFormatted:
      transferCount > 0
        ? formatRawToDecimalString(largestTransferRaw, decimals)
        : null,
    largestBurnFormatted:
      burnCount > 0 ? formatRawToDecimalString(largestBurnRaw, decimals) : null,
    rolling24hOutflowFormatted: formatRawToDecimalString(rollingRaw, decimals),
    confirmedTransferCount: transferCount,
    confirmedBurnCount: burnCount,
  };
}
