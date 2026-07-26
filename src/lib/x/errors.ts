export type XErrorCode =
  | "x_config_invalid"
  | "x_auth_failed"
  | "x_api_error"
  | "x_timeout"
  | "x_network"
  | "x_invalid_response"
  | "x_account_mismatch"
  | "x_persist_failed"
  | "x_poll_failed";

export class XError extends Error {
  code: XErrorCode;
  status: number;
  details?: unknown;

  constructor(
    code: XErrorCode,
    message: string,
    status = 500,
    details?: unknown,
  ) {
    super(message);
    this.name = "XError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
