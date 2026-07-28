export type ChronicleErrorCode =
  | "chronicle_invalid_input"
  | "chronicle_unavailable"
  | "chronicle_generation_failed"
  | "chronicle_grounding_failed"
  | "chronicle_persist_failed";

export class ChronicleError extends Error {
  readonly code: ChronicleErrorCode;
  readonly status: number;

  constructor(code: ChronicleErrorCode, message: string, status = 400) {
    super(message);
    this.name = "ChronicleError";
    this.code = code;
    this.status = status;
  }
}
