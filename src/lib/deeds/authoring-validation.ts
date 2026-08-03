import { z } from "zod";

import {
  EMPTY_EVIDENCE_REQUIREMENTS,
  hasAnyAllowedEvidenceType,
  parseEvidenceRequirements,
} from "@/lib/deeds/evidence";
import type {
  DeedAccessScope,
  DeedEvidenceRequirements,
  DeedReward,
  DeedStatus,
} from "@/lib/deeds/types";
import { parseDeedAccessScope, parseDeedStatus } from "@/lib/deeds/rules";

export class DeedAuthoringError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DeedAuthoringError";
    this.code = code;
    this.status = status;
  }
}

const evidenceFieldSchema = z
  .object({
    allowed: z.boolean(),
    required: z.boolean(),
  })
  .strict();

export const evidenceRequirementsSchema = z
  .object({
    text: evidenceFieldSchema,
    url: evidenceFieldSchema,
    image: evidenceFieldSchema,
    other: evidenceFieldSchema,
  })
  .strict();

/** Safe default for new drafts — valid parser shape with text optional. */
export const DEFAULT_DRAFT_EVIDENCE_REQUIREMENTS: DeedEvidenceRequirements = {
  text: { allowed: true, required: false },
  url: { allowed: false, required: false },
  image: { allowed: false, required: false },
  other: { allowed: false, required: false },
};

const rewardFixedSchema = z
  .object({
    type: z.literal("fixed"),
    amount: z.number().int().min(0),
  })
  .strict();

const rewardRangeSchema = z
  .object({
    type: z.literal("range"),
    min: z.number().int().min(0),
    max: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.max < value.min) {
      ctx.addIssue({
        code: "custom",
        message: "reward max must be >= min",
        path: ["max"],
      });
    }
  });

const rewardNoneSchema = z
  .object({
    type: z.literal("none"),
  })
  .strict();

export const deedRewardInputSchema = z.discriminatedUnion("type", [
  rewardFixedSchema,
  rewardRangeSchema,
  rewardNoneSchema,
]);

const optionalIso = z
  .union([z.string().min(1), z.null()])
  .optional()
  .superRefine((value, ctx) => {
    if (value == null) return;
    if (Number.isNaN(Date.parse(value))) {
      ctx.addIssue({ code: "custom", message: "Invalid ISO datetime" });
    }
  });

export const createDeedDraftSchema = z
  .object({
    title: z.string().min(1).max(200),
    loreDescription: z.string().max(8000).optional().nullable(),
    instructions: z.string().max(8000).optional().nullable(),
    category: z.string().max(80).optional().nullable(),
    slug: z.string().max(80).optional().nullable(),
    accessScope: z.enum(["road", "greenwood", "common"]).optional(),
    reward: deedRewardInputSchema.optional(),
    evidenceRequirements: evidenceRequirementsSchema.optional(),
    startsAt: optionalIso,
    endsAt: optionalIso,
    maxCompletions: z.number().int().positive().nullable().optional(),
    isPublic: z.boolean().optional(),
    isRepeatable: z.boolean().optional(),
    sponsorName: z.string().max(200).optional().nullable(),
    externalRewardNote: z.string().max(1000).optional().nullable(),
  })
  .strict();

export const updateDeedDraftSchema = createDeedDraftSchema.partial().strict();

export type CreateDeedDraftInput = z.infer<typeof createDeedDraftSchema>;
export type UpdateDeedDraftInput = z.infer<typeof updateDeedDraftSchema>;

export type RewardColumns = {
  reward_leaf_fixed: number | null;
  reward_leaf_min: number | null;
  reward_leaf_max: number | null;
};

export function rewardToColumns(reward: DeedReward): RewardColumns {
  if (reward.type === "fixed") {
    return {
      reward_leaf_fixed: reward.amount,
      reward_leaf_min: null,
      reward_leaf_max: null,
    };
  }
  if (reward.type === "range") {
    return {
      reward_leaf_fixed: null,
      reward_leaf_min: reward.min,
      reward_leaf_max: reward.max,
    };
  }
  return {
    reward_leaf_fixed: null,
    reward_leaf_min: null,
    reward_leaf_max: null,
  };
}

export function normalizeSlugCandidate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const slug = trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug.length > 0 ? slug : null;
}

export function generateDraftSlug(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "deed"}-${suffix}`;
}

export function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function nonEmptyText(value: string | null | undefined, field: string): string {
  const trimmed = blankToNull(value);
  if (!trimmed) {
    throw new DeedAuthoringError(
      "invalid_field",
      `${field} is required`,
      400,
    );
  }
  return trimmed;
}

export function validateDateWindow(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
): { startsAt: string | null; endsAt: string | null } {
  const starts = startsAt == null || startsAt === "" ? null : startsAt;
  const ends = endsAt == null || endsAt === "" ? null : endsAt;

  if (starts != null && Number.isNaN(Date.parse(starts))) {
    throw new DeedAuthoringError("invalid_date_window", "startsAt is invalid", 400);
  }
  if (ends != null && Number.isNaN(Date.parse(ends))) {
    throw new DeedAuthoringError("invalid_date_window", "endsAt is invalid", 400);
  }
  if (starts != null && ends != null && Date.parse(ends) < Date.parse(starts)) {
    throw new DeedAuthoringError(
      "invalid_date_window",
      "endsAt must be on or after startsAt",
      400,
    );
  }
  return {
    startsAt: starts ? new Date(starts).toISOString() : null,
    endsAt: ends ? new Date(ends).toISOString() : null,
  };
}

export function normalizeEvidenceRequirements(
  raw: unknown,
  options?: { forPublish?: boolean },
): DeedEvidenceRequirements {
  if (raw == null && !options?.forPublish) {
    return DEFAULT_DRAFT_EVIDENCE_REQUIREMENTS;
  }
  const parsed = parseEvidenceRequirements(raw ?? EMPTY_EVIDENCE_REQUIREMENTS);
  if (!parsed.ok) {
    throw new DeedAuthoringError(
      "invalid_evidence_requirements",
      parsed.error,
      400,
    );
  }
  if (!hasAnyAllowedEvidenceType(parsed.value)) {
    throw new DeedAuthoringError(
      "invalid_evidence_requirements",
      "At least one evidence type must be allowed",
      400,
    );
  }
  return parsed.value;
}

export function assertValidRewardForPublish(reward: DeedReward): void {
  if (reward.type === "range" && reward.max < reward.min) {
    throw new DeedAuthoringError(
      "invalid_reward",
      "reward range max must be >= min",
      400,
    );
  }
  if (reward.type === "fixed" && (!Number.isInteger(reward.amount) || reward.amount < 0)) {
    throw new DeedAuthoringError("invalid_reward", "fixed reward is invalid", 400);
  }
}

export function assertPublishAccessScope(scope: DeedAccessScope): void {
  if (scope === "common") {
    throw new DeedAuthoringError(
      "common_not_available",
      "Common-scope Deeds cannot be published yet",
      400,
    );
  }
  if (scope !== "road" && scope !== "greenwood") {
    throw new DeedAuthoringError("invalid_access_scope", "Invalid access scope", 400);
  }
}

export function assertStatusTransition(
  from: DeedStatus,
  to: DeedStatus,
): void {
  const allowed =
    (from === "draft" && to === "active") ||
    (from === "active" && to === "closed") ||
    (from === "closed" && to === "archived");
  if (!allowed) {
    throw new DeedAuthoringError(
      "invalid_transition",
      `Cannot transition deed from ${from} to ${to}`,
      409,
    );
  }
}

export function assertDraftEditable(status: string): DeedStatus {
  const parsed = parseDeedStatus(status);
  if (!parsed) {
    throw new DeedAuthoringError("invalid_status", "Unknown deed status", 500);
  }
  if (parsed !== "draft") {
    throw new DeedAuthoringError(
      "not_editable",
      "Only draft Deeds can be edited",
      409,
    );
  }
  return parsed;
}

export function resolveAccessScope(
  value: string | undefined,
  fallback: DeedAccessScope = "road",
): DeedAccessScope {
  if (value == null) return fallback;
  const scope = parseDeedAccessScope(value);
  if (!scope) {
    throw new DeedAuthoringError("invalid_access_scope", "Invalid access scope", 400);
  }
  return scope;
}

export { parseDeedStatus, parseDeedAccessScope };
