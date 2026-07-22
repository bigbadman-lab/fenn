import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  toSafeApplicationSummary,
  toSafeProfile,
  type SafeApplicationSummary,
  type SafeProfile,
} from "@/lib/profiles/types";

const PROFILE_SELECT =
  "id, outlaw_number, alias, wallet_address, joined_at, leaf_balance, leaf_lifetime_earned, deeds_completed_count, greenwood_entered_at, privy_user_id";

export type ProfileRecord = {
  id: string;
  outlaw_number: number;
  alias: string | null;
  wallet_address: string;
  joined_at: string;
  leaf_balance: number;
  leaf_lifetime_earned: number;
  deeds_completed_count: number;
  greenwood_entered_at: string | null;
  privy_user_id: string | null;
};

export async function findProfileByPrivyUserId(
  admin: SupabaseClient,
  privyUserId: string,
): Promise<ProfileRecord | null> {
  const { data, error } = await admin
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("privy_user_id", privyUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load profile by privy_user_id: ${error.message}`);
  }

  return (data as ProfileRecord | null) ?? null;
}

export async function findProfileByWallet(
  admin: SupabaseClient,
  walletAddress: string,
): Promise<ProfileRecord | null> {
  const { data, error } = await admin
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("wallet_address", walletAddress)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load profile by wallet: ${error.message}`);
  }

  return (data as ProfileRecord | null) ?? null;
}

export async function findApplicationForProfile(
  admin: SupabaseClient,
  profileId: string,
): Promise<SafeApplicationSummary | null> {
  const { data, error } = await admin
    .from("outlaw_applications")
    .select("review_status, submitted_at")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load outlaw application: ${error.message}`);
  }

  if (!data) return null;
  return toSafeApplicationSummary(data);
}

export function profileDto(row: ProfileRecord): SafeProfile {
  return toSafeProfile(row);
}
