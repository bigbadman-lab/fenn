import type {
  DeedSubmissionRow,
  DeedSubmissionStatus,
  SafeDeedSubmission,
} from "@/lib/deeds/types";

const STATUSES = new Set<DeedSubmissionStatus>([
  "pending",
  "approved",
  "rejected",
]);

export function toSafeDeedSubmission(row: DeedSubmissionRow): SafeDeedSubmission {
  const status = STATUSES.has(row.status as DeedSubmissionStatus)
    ? (row.status as DeedSubmissionStatus)
    : "pending";

  return {
    id: row.id,
    deedId: row.deed_id,
    status,
    evidenceText: row.evidence_text,
    evidenceUrl: row.evidence_url,
    evidenceOther: row.evidence_other,
    hasImageEvidence: Boolean(row.evidence_image_path),
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    leafAwarded: row.leaf_awarded,
  };
}
