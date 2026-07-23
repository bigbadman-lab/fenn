export type MemoryReviewErrorCode =
  | "memory_review_unavailable"
  | "memory_review_timeout"
  | "memory_review_invalid_response"
  | "memory_review_failed"
  | "memory_resolve_failed"
  | "memory_candidate_not_found"
  | "memory_candidate_not_pending";

export class MemoryReviewError extends Error {
  code: MemoryReviewErrorCode;
  status: number;

  constructor(code: MemoryReviewErrorCode, message: string, status = 500) {
    super(message);
    this.name = "MemoryReviewError";
    this.code = code;
    this.status = status;
  }
}
