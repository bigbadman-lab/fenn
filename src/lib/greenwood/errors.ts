export type GreenwoodErrorCode =
  | "unauthorized"
  | "outlaw_registration_required"
  | "greenwood_configuration_error"
  | "greenwood_status_failed"
  | "greenwood_admission_failed"
  | "greenwood_profile_corrupt"
  | "greenwood_sigil_failed"
  | "greenwood_membership_required"
  | "greenwood_presence_failed"
  | "greenwood_gathering_failed"
  | "greenwood_gathering_not_found"
  | "greenwood_gathering_not_active"
  | "greenwood_gathering_closed"
  | "greenwood_gathering_cancelled"
  | "greenwood_gathering_full"
  | "greenwood_gathering_overlap"
  | "greenwood_gathering_not_visible";

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
