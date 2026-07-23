import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CampAiError } from "@/lib/camp/errors";
import type { CampRewardReason } from "@/lib/camp/reward-policy";
import { leafIdempotencyKeys } from "@/lib/leaf/validate";

export type ApplyCampMessageRewardResult = {
  recommended: number;
  actualGrant: number;
  reason: CampRewardReason | string;
  characterDailyGranted: number;
  globalDailyGranted: number;
  ledgerId: string | null;
  finalized: boolean;
};

type GrantCampRewardRpcRow = {
  recommended: number;
  actual_grant: number;
  reason: string;
  character_daily_granted: number;
  global_daily_granted: number;
  ledger_id: string | null;
  finalized: boolean;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Apply Camp LEAF reward for an already-persisted assistant message.
 * Amounts/caps/cooldown are resolved inside grant_camp_message_reward — never
 * from the client. Uses Stage 4 key camp_message:<id>:reward via the RPC.
 *
 * Does not call the Stage 4 JS award helper; ledger insert is transactional in SQL with
 * identical Stage 4 field semantics (profile cache via trigger).
 */
export async function applyCampMessageReward(input: {
  messageId: string;
  rewardDate?: string;
  admin?: SupabaseClient;
}): Promise<ApplyCampMessageRewardResult> {
  const admin = input.admin ?? (await defaultAdmin());

  // Document canonical key shape (RPC builds the same string).
  void leafIdempotencyKeys.campMessageReward(input.messageId);

  const { data, error } = await admin.rpc("grant_camp_message_reward", {
    p_message_id: input.messageId,
    p_reward_date: input.rewardDate ?? null,
  });

  if (error) {
    throw mapCampRewardRpcError(error.message ?? "");
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | GrantCampRewardRpcRow
    | undefined;

  if (!row) {
    throw new CampAiError(
      "camp_reward_failed",
      "Camp reward RPC returned no row",
      500,
    );
  }

  return {
    recommended: Number(row.recommended ?? 0),
    actualGrant: Number(row.actual_grant ?? 0),
    reason: row.reason,
    characterDailyGranted: Number(row.character_daily_granted ?? 0),
    globalDailyGranted: Number(row.global_daily_granted ?? 0),
    ledgerId: row.ledger_id,
    finalized: Boolean(row.finalized),
  };
}

function mapCampRewardRpcError(message: string): CampAiError {
  if (message.includes("FENN_MESSAGE_NOT_FOUND")) {
    return new CampAiError(
      "camp_reward_failed",
      "Camp message not found for reward",
      404,
    );
  }
  if (message.includes("FENN_PROFILE_NOT_FOUND")) {
    return new CampAiError(
      "camp_reward_failed",
      "Profile missing for Camp reward",
      404,
    );
  }
  if (message.includes("FENN_LEDGER_CONFLICT")) {
    return new CampAiError(
      "camp_reward_failed",
      "Camp reward ledger conflict",
      409,
    );
  }
  if (message.includes("FENN_VALIDATION")) {
    return new CampAiError(
      "camp_reward_failed",
      "Camp reward validation failed",
      400,
    );
  }
  return new CampAiError(
    "camp_reward_failed",
    "Camp reward processing failed",
    500,
  );
}
