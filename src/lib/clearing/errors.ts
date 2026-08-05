export type ClearingErrorCode =
  | "clearing_unauthorized"
  | "clearing_registration_required"
  | "clearing_invalid_body"
  | "clearing_invalid_request"
  | "clearing_muted"
  | "clearing_banned"
  | "clearing_read_only"
  | "clearing_rate_limited"
  | "clearing_slow_mode"
  | "clearing_not_found"
  | "clearing_conflict"
  | "clearing_internal"
  | "clearing_cookie_invalid";

export class ClearingError extends Error {
  code: ClearingErrorCode;
  status: number;
  details?: Record<string, unknown>;

  constructor(
    code: ClearingErrorCode,
    message: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ClearingError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
