/**
 * User-facing copy for known submission error codes.
 * Keep in-world and concise; never surface stack/DB text.
 */
export function deedSubmissionErrorCopy(code: string): string {
  switch (code) {
    case "submission_already_pending":
      return "proof has already been left.";
    case "deed_not_open":
      return "this work is no longer being taken.";
    case "non_repeatable_complete":
      return "this deed has already been completed.";
    case "invalid_evidence":
      return "the proof does not meet the notice.";
    case "invalid_requirements":
      return "this notice cannot take proof yet.";
    case "greenwood_not_available_yet":
      return "this work begins beyond the gate.";
    case "common_not_available_yet":
      return "this work is not yet open on the road.";
    case "image_evidence_unavailable":
      return "this deed asks for proof the board cannot yet receive.";
    case "deed_not_found":
      return "this notice could not be found.";
    case "not_registered":
      return "a name must be entered in the book first.";
    case "unauthorized":
      return "entry is required before work can be given.";
    default:
      return "the board could not take that proof.";
  }
}
