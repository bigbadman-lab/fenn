export type EditorialErrorCode =
  | "editorial_unavailable"
  | "editorial_invalid_input"
  | "editorial_generation_failed"
  | "editorial_validation_failed"
  | "editorial_not_found"
  | "editorial_forbidden";

export class EditorialError extends Error {
  readonly code: EditorialErrorCode;
  readonly status: number;

  constructor(code: EditorialErrorCode, message: string, status: number) {
    super(message);
    this.name = "EditorialError";
    this.code = code;
    this.status = status;
  }
}
