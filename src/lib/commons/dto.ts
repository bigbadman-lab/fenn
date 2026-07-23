import { exactNumericString } from "@/lib/commons/numeric";
import type {
  PublicCommonsAllocationDelta,
  PublicCommonsCommitment,
} from "@/lib/commons/types";

type CommitmentRow = {
  asset_symbol: string;
  amount: unknown;
  value_usd_manual: unknown;
  notes?: string | null;
  updated_by_actor_id?: string | null;
};

type AllocationRow = {
  id: string;
  asset_symbol: string;
  delta_amount: unknown;
  reason: string;
  related_contribution_id: string | null;
  actor_id?: string | null;
  created_at: string;
};

export function toPublicCommonsCommitment(
  row: CommitmentRow,
): PublicCommonsCommitment {
  return {
    assetSymbol: row.asset_symbol,
    amount: exactNumericString(row.amount, "amount"),
    valueUsdManual:
      row.value_usd_manual == null
        ? null
        : exactNumericString(row.value_usd_manual, "value_usd_manual"),
  };
}

export function toPublicCommonsAllocationDelta(
  row: AllocationRow,
): PublicCommonsAllocationDelta {
  return {
    id: row.id,
    assetSymbol: row.asset_symbol,
    deltaAmount: exactNumericString(row.delta_amount, "delta_amount"),
    reason: row.reason,
    relatedContributionId: row.related_contribution_id,
    createdAt: row.created_at,
  };
}
