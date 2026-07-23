import { parseEvidenceRequirements } from "@/lib/deeds/evidence";
import type {
  DeedAccessScope,
  DeedListabilityReason,
  DeedReward,
  DeedRow,
  DeedStatus,
  DeedSubmissionOpenReason,
  DeedSubmissionStatus,
  ModerationTransitionResult,
  SafeDeed,
} from "@/lib/deeds/types";

const DEED_STATUSES = new Set<DeedStatus>([
  "draft",
  "active",
  "closed",
  "archived",
]);

const ACCESS_SCOPES = new Set<DeedAccessScope>([
  "road",
  "greenwood",
  "common",
]);

export type RewardMapResult =
  | { ok: true; reward: DeedReward }
  | { ok: false; reward: DeedReward; error: string };

export type ChosenRewardValidationResult = {
  valid: boolean;
  errors: Array<
    | "AMOUNT_REQUIRED"
    | "AMOUNT_NOT_INTEGER"
    | "AMOUNT_MUST_MATCH_FIXED"
    | "AMOUNT_OUT_OF_RANGE"
    | "AMOUNT_MUST_BE_ABSENT_OR_ZERO"
  >;
};

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Map DB reward columns into the domain reward union.
 * Impossible/malformed combinations fail closed to `none`.
 */
export function mapDbReward(row: {
  reward_leaf_fixed: number | null;
  reward_leaf_min: number | null;
  reward_leaf_max: number | null;
}): RewardMapResult {
  const fixed = row.reward_leaf_fixed;
  const min = row.reward_leaf_min;
  const max = row.reward_leaf_max;

  const fixedOnly =
    isNonNegativeInt(fixed) && min == null && max == null;
  const rangeOnly =
    fixed == null &&
    isNonNegativeInt(min) &&
    isNonNegativeInt(max) &&
    max >= min;
  const none = fixed == null && min == null && max == null;

  if (fixedOnly) {
    return { ok: true, reward: { type: "fixed", amount: fixed } };
  }
  if (rangeOnly) {
    return { ok: true, reward: { type: "range", min, max } };
  }
  if (none) {
    return { ok: true, reward: { type: "none" } };
  }

  return {
    ok: false,
    reward: { type: "none" },
    error: "Impossible or malformed DB reward shape",
  };
}

/**
 * Validate a future admin-chosen approval LEAF amount against domain reward.
 * Does not call awardLeaf.
 */
export function validateChosenApprovalReward(
  reward: DeedReward,
  amount: number | null | undefined,
): ChosenRewardValidationResult {
  const errors: ChosenRewardValidationResult["errors"] = [];

  if (reward.type === "none") {
    if (amount != null && amount !== 0) {
      errors.push("AMOUNT_MUST_BE_ABSENT_OR_ZERO");
    }
    return { valid: errors.length === 0, errors };
  }

  if (amount == null) {
    errors.push("AMOUNT_REQUIRED");
    return { valid: false, errors };
  }

  if (!Number.isInteger(amount)) {
    errors.push("AMOUNT_NOT_INTEGER");
    return { valid: false, errors };
  }

  if (reward.type === "fixed") {
    if (amount !== reward.amount) {
      errors.push("AMOUNT_MUST_MATCH_FIXED");
    }
    return { valid: errors.length === 0, errors };
  }

  if (amount < reward.min || amount > reward.max) {
    errors.push("AMOUNT_OUT_OF_RANGE");
  }
  return { valid: errors.length === 0, errors };
}

export function parseDeedStatus(value: string): DeedStatus | null {
  return DEED_STATUSES.has(value as DeedStatus)
    ? (value as DeedStatus)
    : null;
}

export function parseDeedAccessScope(value: string): DeedAccessScope | null {
  return ACCESS_SCOPES.has(value as DeedAccessScope)
    ? (value as DeedAccessScope)
    : null;
}

function toIsoOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Project a DB deed row into a SafeDeed public DTO.
 * Malformed evidence/reward never throws — surfaces invalid flags / fail-closed shapes.
 */
export function toSafeDeed(row: DeedRow): SafeDeed {
  const evidence = parseEvidenceRequirements(row.evidence_requirements);
  const rewardMapped = mapDbReward(row);
  const status = parseDeedStatus(row.status) ?? "archived";
  const accessScope = parseDeedAccessScope(row.access_scope) ?? "road";

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    loreDescription: row.lore_description,
    instructions: row.instructions,
    category: row.category,
    accessScope,
    status,
    reward: rewardMapped.reward,
    evidenceRequirements: evidence.value,
    evidenceRequirementsInvalid: !evidence.ok,
    startsAt: toIsoOrNull(row.starts_at),
    endsAt: toIsoOrNull(row.ends_at),
    maxCompletions: row.max_completions,
    completionsCount: row.completions_count,
    isRepeatable: row.is_repeatable,
    isPublic: row.is_public,
    sponsorName: row.sponsor_name,
    externalRewardNote: row.external_reward_note,
    publishedAt: toIsoOrNull(row.published_at),
  };
}

export function isDeedPubliclyListable(
  deed: Pick<
    SafeDeed,
    "status" | "isPublic" | "startsAt" | "endsAt"
  >,
  now: Date = new Date(),
): { listable: boolean; reason: DeedListabilityReason } {
  if (deed.status !== "active") {
    return { listable: false, reason: "not_active" };
  }
  if (!deed.isPublic) {
    return { listable: false, reason: "not_public" };
  }
  if (deed.startsAt) {
    const starts = Date.parse(deed.startsAt);
    if (!Number.isNaN(starts) && now.getTime() < starts) {
      return { listable: false, reason: "not_started" };
    }
  }
  if (deed.endsAt) {
    const ends = Date.parse(deed.endsAt);
    if (!Number.isNaN(ends) && now.getTime() > ends) {
      return { listable: false, reason: "ended" };
    }
  }
  return { listable: true, reason: "ok" };
}

export function isDeedOpenForSubmission(
  deed: Pick<
    SafeDeed,
    | "status"
    | "startsAt"
    | "endsAt"
    | "maxCompletions"
    | "completionsCount"
  >,
  now: Date = new Date(),
): { open: boolean; reason: DeedSubmissionOpenReason } {
  if (deed.status === "draft") {
    return { open: false, reason: "draft" };
  }
  if (deed.status === "closed") {
    return { open: false, reason: "closed" };
  }
  if (deed.status === "archived") {
    return { open: false, reason: "archived" };
  }
  if (deed.status !== "active") {
    return { open: false, reason: "not_active" };
  }

  if (deed.startsAt) {
    const starts = Date.parse(deed.startsAt);
    if (!Number.isNaN(starts) && now.getTime() < starts) {
      return { open: false, reason: "not_started" };
    }
  }
  if (deed.endsAt) {
    const ends = Date.parse(deed.endsAt);
    if (!Number.isNaN(ends) && now.getTime() > ends) {
      return { open: false, reason: "ended" };
    }
  }

  if (
    deed.maxCompletions != null &&
    deed.completionsCount >= deed.maxCompletions
  ) {
    return { open: false, reason: "completion_cap_reached" };
  }

  return { open: true, reason: "ok" };
}

/**
 * Stage 6.3 submission access: Road only.
 * Greenwood membership is Stage 8; Common mechanics are not Stage-6-ready.
 * Do not invent eligibility.
 */
export function evaluateStage6AccessScope(scope: DeedAccessScope): {
  allowed: boolean;
  reason?: "greenwood_not_available_yet" | "common_not_available_yet";
} {
  if (scope === "greenwood") {
    return { allowed: false, reason: "greenwood_not_available_yet" };
  }
  if (scope === "common") {
    return { allowed: false, reason: "common_not_available_yet" };
  }
  return { allowed: true };
}

/**
 * Repeatable / pending / approved uniqueness rules (DB-aligned, pure).
 * Does not invent cooldowns.
 */
export function canProfileSubmitDeed(input: {
  isRepeatable: boolean;
  hasPendingSubmission: boolean;
  hasApprovedSubmission: boolean;
}): {
  allowed: boolean;
  reason?: "pending_exists" | "already_completed";
} {
  if (input.hasPendingSubmission) {
    return { allowed: false, reason: "pending_exists" };
  }
  if (!input.isRepeatable && input.hasApprovedSubmission) {
    return { allowed: false, reason: "already_completed" };
  }
  return { allowed: true };
}

/**
 * Stage 6 moderation finality: pending → approved | rejected only.
 */
export function canTransitionSubmissionStatus(
  from: DeedSubmissionStatus,
  to: DeedSubmissionStatus,
): ModerationTransitionResult {
  if (from === to) {
    return { allowed: false, reason: "same_status" };
  }
  if (from !== "pending") {
    return { allowed: false, reason: "not_pending" };
  }
  if (to !== "approved" && to !== "rejected") {
    return { allowed: false, reason: "invalid_to" };
  }
  return { allowed: true };
}
