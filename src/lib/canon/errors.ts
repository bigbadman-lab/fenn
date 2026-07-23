export type CanonErrorCode =
  | "canon_sync_failed"
  | "canon_read_failed"
  | "canon_invalid_corpus";

export class CanonError extends Error {
  code: CanonErrorCode;
  status: number;

  constructor(code: CanonErrorCode, message: string, status = 500) {
    super(message);
    this.name = "CanonError";
    this.code = code;
    this.status = status;
  }
}
