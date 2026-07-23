import { exactNumericString } from "@/lib/commons/numeric";
import type { PublicTreasuryContribution } from "@/lib/treasury/types";

type ContributionRow = {
  id: string;
  asset_symbol: string;
  amount: unknown;
  amount_raw: unknown;
  value_usd_at_receipt: unknown;
  tx_hash: string | null;
  from_address: string | null;
  project_name: string | null;
  purpose: string | null;
  designation: string;
  verified: boolean;
  verified_at: string | null;
  created_at: string;
  notes?: string | null;
};

/**
 * Map a verified contribution row to a public DTO.
 * Excludes notes. Rejects unverified rows.
 */
export function toPublicTreasuryContribution(
  row: ContributionRow,
): PublicTreasuryContribution {
  if (!row.verified) {
    throw new Error("Unverified contributions must not become public");
  }

  const designation = row.designation;
  if (
    designation !== "treasury" &&
    designation !== "commons_intent" &&
    designation !== "other"
  ) {
    throw new Error("Invalid contribution designation");
  }

  return {
    id: row.id,
    assetSymbol: row.asset_symbol,
    amount: exactNumericString(row.amount, "amount"),
    amountRaw:
      row.amount_raw == null
        ? null
        : exactNumericString(row.amount_raw, "amount_raw"),
    valueUsdAtReceipt:
      row.value_usd_at_receipt == null
        ? null
        : exactNumericString(row.value_usd_at_receipt, "value_usd_at_receipt"),
    txHash: row.tx_hash,
    fromAddress: row.from_address,
    projectName: row.project_name,
    purpose: row.purpose,
    designation,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}
