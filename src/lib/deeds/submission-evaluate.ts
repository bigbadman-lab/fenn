import { z } from "zod";

import { validateSubmissionEvidence } from "@/lib/deeds/evidence";
import {
  canProfileSubmitDeed,
  evaluateDeedAccessScope,
  isDeedOpenForSubmission,
} from "@/lib/deeds/rules";
import type {
  DeedSubmissionErrorCode,
  DeedSubmissionEvidenceInput,
  DeedSubmissionStatus,
  EvidenceValidationError,
  NormalizedDeedEvidence,
  SafeDeed,
} from "@/lib/deeds/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDeedUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Own-history filter contract — both keys always required.
 * Callers must supply the verified profile id; never omit profile scoping.
 */
export function ownDeedSubmissionFilters(
  profileId: string,
  deedId: string,
): { profile_id: string; deed_id: string } {
  const profile_id = profileId.trim();
  const deed_id = deedId.trim();
  if (!profile_id) {
    throw new Error("profileId required");
  }
  if (!isDeedUuid(deed_id)) {
    throw new Error("invalid deed id");
  }
  return { profile_id, deed_id };
}

/**
 * Strict API body.
 * Accepts imageRef (server-issued upload reference) — never raw imagePath.
 */
export const createDeedSubmissionBodySchema = z
  .object({
    evidenceText: z.string().optional().nullable(),
    evidenceUrl: z.string().optional().nullable(),
    evidenceOther: z.string().optional().nullable(),
    imageRef: z.string().optional().nullable(),
  })
  .strict();

export type CreateDeedSubmissionBody = z.infer<
  typeof createDeedSubmissionBodySchema
>;

export type ExistingSubmissionSummary = {
  status: DeedSubmissionStatus;
};

export type EvaluateCreateDeedSubmissionResult =
  | {
      ok: true;
      evidence: NormalizedDeedEvidence;
    }
  | {
      ok: false;
      code: DeedSubmissionErrorCode;
      evidenceErrors?: EvidenceValidationError[];
    };

/**
 * Eligibility for uploading image evidence (before final submission).
 * Does not validate evidence payload contents.
 */
export function evaluateDeedUploadEligibility(input: {
  deed: SafeDeed | null;
  existingSubmissions: ExistingSubmissionSummary[];
  /** Permanent Greenwood membership from verified profile — never client-claimed. */
  greenwoodEnteredAt: string | null;
  now?: Date;
}):
  | { ok: true }
  | { ok: false; code: DeedSubmissionErrorCode } {
  const now = input.now ?? new Date();
  const { deed } = input;

  if (!deed || !deed.isPublic) {
    return { ok: false, code: "deed_not_found" };
  }

  const open = isDeedOpenForSubmission(deed, now);
  if (!open.open) {
    return { ok: false, code: "deed_not_open" };
  }

  const access = evaluateDeedAccessScope(deed.accessScope, {
    greenwoodEnteredAt: input.greenwoodEnteredAt,
  });
  if (!access.allowed) {
    return {
      ok: false,
      code: access.reason ?? "greenwood_membership_required",
    };
  }

  if (deed.evidenceRequirementsInvalid) {
    return { ok: false, code: "invalid_requirements" };
  }

  if (!deed.evidenceRequirements.image.allowed) {
    return { ok: false, code: "invalid_evidence" };
  }

  const hasPending = input.existingSubmissions.some((s) => s.status === "pending");
  const hasApproved = input.existingSubmissions.some(
    (s) => s.status === "approved",
  );
  const repeat = canProfileSubmitDeed({
    isRepeatable: deed.isRepeatable,
    hasPendingSubmission: hasPending,
    hasApprovedSubmission: hasApproved,
  });
  if (!repeat.allowed) {
    if (repeat.reason === "pending_exists") {
      return { ok: false, code: "submission_already_pending" };
    }
    return { ok: false, code: "non_repeatable_complete" };
  }

  return { ok: true };
}

/**
 * Pure gate for creating a pending submission.
 *
 * `evidence.imagePath` must already be a server-verified storage path
 * (or null). Callers must never pass a raw client path.
 */
export function evaluateCreateDeedSubmission(input: {
  deed: SafeDeed | null;
  existingSubmissions: ExistingSubmissionSummary[];
  evidence: DeedSubmissionEvidenceInput;
  /** Permanent Greenwood membership from verified profile — never client-claimed. */
  greenwoodEnteredAt: string | null;
  /** When true, imagePath was verified by the server upload resolver. */
  imagePathVerified?: boolean;
  now?: Date;
}): EvaluateCreateDeedSubmissionResult {
  const now = input.now ?? new Date();
  const { deed } = input;

  if (!deed) {
    return { ok: false, code: "deed_not_found" };
  }

  if (!deed.isPublic) {
    return { ok: false, code: "deed_not_found" };
  }

  const open = isDeedOpenForSubmission(deed, now);
  if (!open.open) {
    return { ok: false, code: "deed_not_open" };
  }

  const access = evaluateDeedAccessScope(deed.accessScope, {
    greenwoodEnteredAt: input.greenwoodEnteredAt,
  });
  if (!access.allowed) {
    return {
      ok: false,
      code: access.reason ?? "greenwood_membership_required",
    };
  }

  if (deed.evidenceRequirementsInvalid) {
    return { ok: false, code: "invalid_requirements" };
  }

  const rawImage =
    input.evidence.imagePath != null
      ? String(input.evidence.imagePath).trim()
      : "";
  const hasImage = rawImage.length > 0;

  if (hasImage && !input.imagePathVerified) {
    return { ok: false, code: "invalid_image_ref" };
  }

  const hasPending = input.existingSubmissions.some((s) => s.status === "pending");
  const hasApproved = input.existingSubmissions.some(
    (s) => s.status === "approved",
  );
  const repeat = canProfileSubmitDeed({
    isRepeatable: deed.isRepeatable,
    hasPendingSubmission: hasPending,
    hasApprovedSubmission: hasApproved,
  });
  if (!repeat.allowed) {
    if (repeat.reason === "pending_exists") {
      return { ok: false, code: "submission_already_pending" };
    }
    return { ok: false, code: "non_repeatable_complete" };
  }

  const validated = validateSubmissionEvidence(
    deed.evidenceRequirements,
    {
      text: input.evidence.text,
      url: input.evidence.url,
      other: input.evidence.other,
      imagePath: hasImage ? rawImage : null,
    },
    { requirementsValid: true },
  );

  if (!validated.valid) {
    return {
      ok: false,
      code: "invalid_evidence",
      evidenceErrors: validated.errors,
    };
  }

  return {
    ok: true,
    evidence: validated.evidence,
  };
}
