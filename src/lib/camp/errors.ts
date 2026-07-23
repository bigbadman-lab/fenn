export type CampAiErrorCode =
  | "camp_ai_unavailable"
  | "camp_ai_timeout"
  | "camp_ai_invalid_response"
  | "camp_message_invalid"
  | "camp_character_unknown"
  | "camp_character_not_found"
  | "camp_character_locked"
  | "camp_character_inactive"
  | "camp_character_misconfigured"
  | "camp_not_authenticated"
  | "camp_not_registered"
  | "camp_session_closed"
  | "camp_request_conflict"
  | "camp_write_failed"
  | "camp_reward_failed";

export class CampAiError extends Error {
  code: CampAiErrorCode;
  status: number;

  constructor(code: CampAiErrorCode, message: string, status = 400) {
    super(message);
    this.name = "CampAiError";
    this.code = code;
    this.status = status;
  }
}

/** User-facing Camp copy for known error codes. */
export function campErrorCopy(code: string): string {
  switch (code) {
    case "camp_not_authenticated":
      return "entry is required at the fire.";
    case "camp_not_registered":
      return "the fire does not know your name.";
    case "camp_character_not_found":
    case "camp_character_unknown":
    case "camp_character_inactive":
    case "camp_character_misconfigured":
      return "that voice is not at the fire.";
    case "camp_character_locked":
      return "that voice is still sealed.";
    case "camp_message_invalid":
      return "that could not be spoken.";
    case "camp_session_closed":
      return "this conversation is closed.";
    case "camp_ai_unavailable":
    case "camp_ai_timeout":
    case "camp_ai_invalid_response":
      return "the fire went quiet.";
    case "camp_request_conflict":
      return "that turn is already being spoken.";
    default:
      return "the fire went quiet.";
  }
}
