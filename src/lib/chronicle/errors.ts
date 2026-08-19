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

/**
 * Keeper-facing Book copy. Prefer codes over raw `error.message`
 * (which may contain internal diagnostics).
 */
export function deskFacingChronicleError(error: ChronicleError): string {
  switch (error.code) {
    case "chronicle_persist_failed":
      return "VELL could not write this entry to the Book.";
    case "chronicle_generation_failed":
    case "chronicle_grounding_failed":
      return "VELL could not compose this entry.";
    case "chronicle_unavailable":
      return "The Book could not be opened.";
    case "chronicle_invalid_input":
      return "That date could not be used.";
    default:
      return "VELL could not complete this step.";
  }
}
