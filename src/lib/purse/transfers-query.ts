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
      "id, operation_id, recipient_address, amount_formatted, token_address, chain_id, tx_hash, confirmed_at",
    )
    .eq("status", "confirmed")
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
    };
  });
}
