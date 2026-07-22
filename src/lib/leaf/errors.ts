export type LeafErrorCode =
  | "PROFILE_NOT_FOUND"
  | "INVALID_AMOUNT"
  | "INVALID_LIFETIME_DELTA"
  | "INVALID_SOURCE_TYPE"
  | "INVALID_IDEMPOTENCY_KEY"
  | "INVALID_REASON"
  | "INVALID_ACTOR"
  | "INVALID_METADATA"
  | "INVALID_PROFILE_ID"
  | "LEAF_IDEMPOTENCY_CONFLICT"
  | "LEAF_WRITE_FAILED"
  | "LEAF_AUDIT_FAILED"
  | "LEAF_READ_FAILED"
  | "UNSAFE_BIGINT";

export class LeafError extends Error {
  code: LeafErrorCode;
  status: number;

  constructor(code: LeafErrorCode, message: string, status = 400) {
    super(message);
    this.name = "LeafError";
    this.code = code;
    this.status = status;
  }
}
