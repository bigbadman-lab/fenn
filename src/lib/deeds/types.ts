/**
 * Stage 6 Deeds domain types.
 * Reflect existing DB schema; do not invent parallel concepts.
 */

export type DeedStatus = "draft" | "active" | "closed" | "archived";

export type DeedAccessScope = "road" | "greenwood" | "common";

export type DeedReward =
  | { type: "fixed"; amount: number }
  | { type: "range"; min: number; max: number }
  | { type: "none" };

export type EvidenceFieldRequirement = {
  allowed: boolean;
  required: boolean;
};

export type DeedEvidenceRequirements = {
  text: EvidenceFieldRequirement;
  url: EvidenceFieldRequirement;
  image: EvidenceFieldRequirement;
  other: EvidenceFieldRequirement;
};

export type EvidenceField = keyof DeedEvidenceRequirements;

/** Parsed evidence_requirements outcome for untrusted jsonb. */
export type EvidenceRequirementsParseResult =
  | { ok: true; value: DeedEvidenceRequirements }
  | { ok: false; error: string; value: DeedEvidenceRequirements };

/** Future submission evidence payload (domain only). */
export type DeedSubmissionEvidenceInput = {
  text?: string | null;
  url?: string | null;
  imagePath?: string | null;
  other?: string | null;
};

export type NormalizedDeedEvidence = {
  text: string | null;
  url: string | null;
  imagePath: string | null;
  other: string | null;
};

export type EvidenceValidationErrorCode =
  | "REQUIRED_TEXT_MISSING"
  | "REQUIRED_URL_MISSING"
  | "REQUIRED_IMAGE_MISSING"
  | "REQUIRED_OTHER_MISSING"
  | "TEXT_NOT_ALLOWED"
  | "URL_NOT_ALLOWED"
  | "IMAGE_NOT_ALLOWED"
  | "OTHER_NOT_ALLOWED"
  | "INVALID_URL"
  | "NO_EVIDENCE"
  | "INVALID_REQUIREMENTS";

export type EvidenceValidationError = {
  code: EvidenceValidationErrorCode;
  field?: EvidenceField | "evidence";
};

export type EvidenceValidationResult = {
  valid: boolean;
  errors: EvidenceValidationError[];
  evidence: NormalizedDeedEvidence;
};

export type DeedListabilityReason =
  | "ok"
  | "not_active"
  | "not_public"
  | "not_started"
  | "ended";

export type DeedSubmissionOpenReason =
  | "ok"
  | "not_active"
  | "closed"
  | "archived"
  | "draft"
  | "not_started"
  | "ended"
  | "completion_cap_reached";

export type DeedSubmissionStatus = "pending" | "approved" | "rejected";

export type ModerationTransitionResult = {
  allowed: boolean;
  reason?: "invalid_from" | "invalid_to" | "not_pending" | "same_status";
};

/** Public-facing submission DTO (own history / create response). */
export type SafeDeedSubmission = {
  id: string;
  deedId: string;
  status: DeedSubmissionStatus;
  evidenceText: string | null;
  evidenceUrl: string | null;
  evidenceOther: string | null;
  /** Image path is never exposed; flag only if a path was stored. */
  hasImageEvidence: boolean;
  submittedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  leafAwarded: number | null;
};

export type DeedSubmissionRow = {
  id: string;
  deed_id: string;
  profile_id: string;
  status: string;
  evidence_text: string | null;
  evidence_url: string | null;
  evidence_image_path: string | null;
  evidence_other: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by_actor_id?: string | null;
  review_note: string | null;
  leaf_awarded: number | null;
  leaf_ledger_id?: string | null;
};

export type DeedSubmissionErrorCode =
  | "deed_not_found"
  | "deed_not_open"
  | "greenwood_membership_required"
  | "common_not_available_yet"
  | "image_evidence_unavailable"
  | "invalid_image_ref"
  | "invalid_evidence"
  | "invalid_requirements"
  | "submission_already_pending"
  | "non_repeatable_complete"
  | "not_registered"
  | "invalid_deed_id"
  | "invalid_json"
  | "write_failed";

/** Public-facing Deed DTO. */
export type SafeDeed = {
  id: string;
  slug: string | null;
  title: string;
  loreDescription: string;
  instructions: string;
  category: string | null;
  accessScope: DeedAccessScope;
  status: DeedStatus;
  reward: DeedReward;
  evidenceRequirements: DeedEvidenceRequirements;
  /** True when evidence_requirements jsonb failed closed parsing. */
  evidenceRequirementsInvalid: boolean;
  startsAt: string | null;
  endsAt: string | null;
  maxCompletions: number | null;
  completionsCount: number;
  isRepeatable: boolean;
  isPublic: boolean;
  sponsorName: string | null;
  externalRewardNote: string | null;
  publishedAt: string | null;
};

/** Raw DB row shape for deeds (snake_case). */
export type DeedRow = {
  id: string;
  slug: string | null;
  title: string;
  lore_description: string;
  instructions: string;
  category: string | null;
  access_scope: string;
  status: string;
  reward_leaf_fixed: number | null;
  reward_leaf_min: number | null;
  reward_leaf_max: number | null;
  evidence_requirements: unknown;
  eligibility: unknown;
  starts_at: string | null;
  ends_at: string | null;
  max_completions: number | null;
  completions_count: number;
  is_public: boolean;
  is_repeatable: boolean;
  sponsor_name: string | null;
  sponsor_contribution_id?: string | null;
  external_reward_note: string | null;
  common_target_count?: number | null;
  common_progress_count?: number;
  published_at: string | null;
  created_at?: string;
  updated_at?: string;
};
