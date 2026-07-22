export type SafeProfile = {
  id: string;
  outlawNumber: number;
  alias: string | null;
  walletAddress: string;
  joinedAt: string;
  leafBalance: number;
  leafLifetimeEarned: number;
  deedsCompletedCount: number;
  greenwoodEnteredAt: string | null;
};

export type SafeApplicationSummary = {
  status: string;
  submittedAt: string;
};

type ProfileRow = {
  id: string;
  outlaw_number: number;
  alias: string | null;
  wallet_address: string;
  joined_at: string;
  leaf_balance: number;
  leaf_lifetime_earned: number;
  deeds_completed_count: number;
  greenwood_entered_at: string | null;
};

type ApplicationRow = {
  review_status: string;
  submitted_at: string;
};

export function toSafeProfile(row: ProfileRow): SafeProfile {
  return {
    id: row.id,
    outlawNumber: row.outlaw_number,
    alias: row.alias,
    walletAddress: row.wallet_address,
    joinedAt: row.joined_at,
    leafBalance: row.leaf_balance,
    leafLifetimeEarned: row.leaf_lifetime_earned,
    deedsCompletedCount: row.deeds_completed_count,
    greenwoodEnteredAt: row.greenwood_entered_at,
  };
}

export function toSafeApplicationSummary(
  row: ApplicationRow,
): SafeApplicationSummary {
  return {
    status: row.review_status,
    submittedAt: row.submitted_at,
  };
}

export function formatOutlawNumber(outlawNumber: number): string {
  return String(outlawNumber).padStart(5, "0");
}
