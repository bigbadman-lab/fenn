export type GreenwoodErrorCode =
  | "unauthorized"
  | "outlaw_registration_required"
  | "greenwood_configuration_error"
  | "greenwood_status_failed"
  | "greenwood_admission_failed"
  | "greenwood_profile_corrupt";

export class GreenwoodError extends Error {
  code: GreenwoodErrorCode;
  status: number;

  constructor(code: GreenwoodErrorCode, message: string, status = 400) {
    super(message);
    this.name = "GreenwoodError";
    this.code = code;
    this.status = status;
  }
}
