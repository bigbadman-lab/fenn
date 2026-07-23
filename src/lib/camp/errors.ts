export type CampAiErrorCode =
  | "camp_ai_unavailable"
  | "camp_ai_timeout"
  | "camp_ai_invalid_response"
  | "camp_message_invalid"
  | "camp_character_unknown";

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
