export type {
  DeedAccessScope,
  DeedEvidenceRequirements,
  DeedListabilityReason,
  DeedReward,
  DeedRow,
  DeedStatus,
  DeedSubmissionErrorCode,
  DeedSubmissionEvidenceInput,
  DeedSubmissionOpenReason,
  DeedSubmissionRow,
  DeedSubmissionStatus,
  EvidenceField,
  EvidenceFieldRequirement,
  EvidenceRequirementsParseResult,
  EvidenceValidationError,
  EvidenceValidationErrorCode,
  EvidenceValidationResult,
  ModerationTransitionResult,
  NormalizedDeedEvidence,
  SafeDeed,
  SafeDeedSubmission,
} from "@/lib/deeds/types";

export {
  EMPTY_EVIDENCE_REQUIREMENTS,
  hasAnyAllowedEvidenceType,
  isAbsoluteHttpUrl,
  normalizeSubmissionEvidence,
  parseEvidenceRequirements,
  validateSubmissionEvidence,
} from "@/lib/deeds/evidence";

export {
  canProfileSubmitDeed,
  canTransitionSubmissionStatus,
  evaluateStage6AccessScope,
  isDeedOpenForSubmission,
  isDeedPubliclyListable,
  mapDbReward,
  parseDeedAccessScope,
  parseDeedStatus,
  toSafeDeed,
  validateChosenApprovalReward,
} from "@/lib/deeds/rules";

export {
  formatAccessScope,
  formatBoardIndex,
  formatCategoryLabel,
  formatDeedBoardDate,
  formatDeedReward,
  formatEvidenceDetail,
  formatEvidenceSummary,
  formatRepeatability,
} from "@/lib/deeds/format";

export {
  createDeedSubmissionBodySchema,
  evaluateCreateDeedSubmission,
  evaluateDeedUploadEligibility,
  ownDeedSubmissionFilters,
} from "@/lib/deeds/submission-evaluate";

export { toSafeDeedSubmission } from "@/lib/deeds/submission-dto";

export { deedSubmissionErrorCopy } from "@/lib/deeds/submission-errors";

export {
  mapDeedModerationRpcError,
  DeedModerationRpcError,
  type DeedModerationRpcErrorCode,
} from "@/lib/deeds/moderation-rpc-errors";

export {
  DEED_EVIDENCE_BUCKET,
  DEED_IMAGE_MAX_BYTES,
  DEED_IMAGE_MIME_TYPES,
  assertImageRefOwnedBy,
  buildPendingImagePath,
  detectDeedImageMimeFromBytes,
  parsePendingImagePath,
  validateDeedImageFile,
} from "@/lib/deeds/image-evidence";

// Public read helpers live in `@/lib/deeds/queries` (server-only).
// Write helpers live in `@/lib/deeds/submissions` (server-only).
// Image Storage I/O lives in `@/lib/deeds/image-upload` (server-only).
// Moderation queue/signing lives in `@/lib/deeds/moderation` (server-only).
// Atomic moderation RPCs live in `@/lib/deeds/moderation-rpc` (server-only).
// Do not re-export them here so pure domain helpers stay importable in tests.