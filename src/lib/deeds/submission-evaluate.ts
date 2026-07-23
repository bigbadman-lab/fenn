import { z } from "zod";

import { validateSubmissionEvidence } from "@/lib/deeds/evidence";
import {
  canProfileSubmitDeed,
  evaluateStage6AccessScope,
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

/** Strict API body — rejects profileId, status, LEAF, imagePath, deed config. */
export const createDeedSubmissionBodySchema = z
  .object({
    evidenceText: z.string().optional().nullable(),
    evidenceUrl: z.string().optional().nullable(),
    evidenceOther: z.string().optional().nullable(),
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
 * Pure gate for creating a pending submission.
 * Callers supply the canonical Deed + the caller's existing submissions.
 */
export function evaluateCreateDeedSubmission(input: {
  deed: SafeDeed | null;
  existingSubmissions: ExistingSubmissionSummary[];
  evidence: DeedSubmissionEvidenceInput;
  now?: Date;
}): EvaluateCreateDeedSubmissionResult {
  const now = input.now ?? new Date();
  const { deed } = input;

  if (!deed) {
    return { ok: false, code: "deed_not_found" };
  }

  // Public board submissions only — do not trust private/admin drafts.
  if (!deed.isPublic) {
    return { ok: false, code: "deed_not_found" };
  }

  const open = isDeedOpenForSubmission(deed, now);
  if (!open.open) {
    return { ok: false, code: "deed_not_open" };
  }

  const access = evaluateStage6AccessScope(deed.accessScope);
  if (!access.allowed) {
    return {
      ok: false,
      code: access.reason ?? "greenwood_not_available_yet",
    };
  }

  if (deed.evidenceRequirementsInvalid) {
    return { ok: false, code: "invalid_requirements" };
  }

  // Stage 6.3: Storage does not exist — required image fails closed.
  if (deed.evidenceRequirements.image.required) {
    return { ok: false, code: "image_evidence_unavailable" };
  }

  // Never accept client-supplied image paths in this stage.
  if (input.evidence.imagePath != null && String(input.evidence.imagePath).trim()) {
    return { ok: false, code: "image_evidence_unavailable" };
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

  const evidenceWithoutImage: DeedSubmissionEvidenceInput = {
    text: input.evidence.text,
    url: input.evidence.url,
    other: input.evidence.other,
    imagePath: null,
  };

  const validated = validateSubmissionEvidence(
    deed.evidenceRequirements,
    evidenceWithoutImage,
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
