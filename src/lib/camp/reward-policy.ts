/**
 * Canonical Camp reward configuration keys / MVP defaults.
 * Runtime authority: camp_characters.daily_leaf_cap + app_settings.
 * Do not scatter magic numbers across feature code.
 */

export const CAMP_REWARD_SETTING_KEYS = {
  globalDailyLeafCap: "camp.global_daily_leaf_cap",
  rewardCooldownSeconds: "camp.reward_cooldown_seconds",
} as const;

/** Seeded MVP defaults — DB values win when present. */
export const CAMP_REWARD_DEFAULTS = {
  characterDailyLeafCap: 5,
  globalDailyLeafCap: 10,
  rewardCooldownSeconds: 60,
} as const;

export type CampRewardReason =
  | "not_recommended"
  | "eligible"
  | "cooldown"
  | "character_cap"
  | "global_cap"
  | "cap_partial"
  | "already_granted"
  | "recovered";

export type CampRewardPolicyResult = {
  recommended: number;
  actualGrant: number;
  reason: CampRewardReason;
};

function clampRecommendation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(3, Math.max(0, Math.trunc(value)));
}

/**
 * Deterministic Camp reward policy (mirrors grant_camp_message_reward SQL).
 * Never increases above recommendation. Does not write LEAF.
 */
export function resolveCampRewardEligibility(input: {
  recommended: number;
  characterGranted: number;
  characterCap: number;
  globalGranted: number;
  globalCap: number;
  cooldownActive: boolean;
}): CampRewardPolicyResult {
  const recommended = clampRecommendation(input.recommended);

  if (recommended <= 0) {
    return { recommended: 0, actualGrant: 0, reason: "not_recommended" };
  }

  if (input.cooldownActive) {
    return { recommended, actualGrant: 0, reason: "cooldown" };
  }

  const characterCap = Math.max(0, Math.trunc(input.characterCap));
  const globalCap = Math.max(0, Math.trunc(input.globalCap));
  const characterGranted = Math.max(0, Math.trunc(input.characterGranted));
  const globalGranted = Math.max(0, Math.trunc(input.globalGranted));

  const characterRemaining = Math.max(0, characterCap - characterGranted);
  const globalRemaining = Math.max(0, globalCap - globalGranted);

  if (characterRemaining <= 0) {
    return { recommended, actualGrant: 0, reason: "character_cap" };
  }
  if (globalRemaining <= 0) {
    return { recommended, actualGrant: 0, reason: "global_cap" };
  }

  const actualGrant = Math.min(
    recommended,
    characterRemaining,
    globalRemaining,
  );

  if (actualGrant < recommended) {
    return { recommended, actualGrant, reason: "cap_partial" };
  }

  return { recommended, actualGrant, reason: "eligible" };
}

/** UTC calendar date YYYY-MM-DD for reward accounting. */
export function campRewardUtcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isCampRewardCooldownActive(input: {
  lastRewardedAt: Date | string | null | undefined;
  now?: Date;
  cooldownSeconds?: number;
}): boolean {
  if (!input.lastRewardedAt) return false;
  const seconds =
    input.cooldownSeconds ?? CAMP_REWARD_DEFAULTS.rewardCooldownSeconds;
  if (seconds <= 0) return false;
  const last =
    typeof input.lastRewardedAt === "string"
      ? new Date(input.lastRewardedAt)
      : input.lastRewardedAt;
  if (Number.isNaN(last.getTime())) return false;
  const now = input.now ?? new Date();
  return now.getTime() - last.getTime() < seconds * 1000;
}
