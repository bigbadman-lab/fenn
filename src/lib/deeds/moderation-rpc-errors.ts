export type DeedModerationRpcErrorCode =
  | "submission_not_found"
  | "submission_already_reviewed"
  | "invalid_reward"
  | "invalid_deed_reward_config"
  | "completion_cap_reached"
  | "invalid_review_note"
  | "ledger_conflict"
  | "profile_not_found"
  | "rpc_failed";

export class DeedModerationRpcError extends Error {
  code: DeedModerationRpcErrorCode;
  status: number;

  constructor(code: DeedModerationRpcErrorCode, message: string, status = 400) {
    super(message);
    this.name = "DeedModerationRpcError";
    this.code = code;
    this.status = status;
  }
}

/** Map Postgres RPC exception text to stable application codes. */
export function mapDeedModerationRpcError(message: string): DeedModerationRpcError {
  const m = message ?? "";

  if (m.includes("FENN_SUBMISSION_NOT_FOUND")) {
    return new DeedModerationRpcError(
      "submission_not_found",
      "Submission not found",
      404,
    );
  }
  if (m.includes("FENN_SUBMISSION_ALREADY_REVIEWED")) {
    return new DeedModerationRpcError(
      "submission_already_reviewed",
      "Submission already reviewed",
      409,
    );
  }
  if (m.includes("FENN_COMPLETION_CAP_REACHED")) {
    return new DeedModerationRpcError(
      "completion_cap_reached",
      "Deed completion cap reached",
      409,
    );
  }
  if (m.includes("FENN_INVALID_DEED_REWARD_CONFIG")) {
    return new DeedModerationRpcError(
      "invalid_deed_reward_config",
      "Deed reward configuration is invalid",
      422,
    );
  }
  if (m.includes("FENN_INVALID_REWARD")) {
    return new DeedModerationRpcError(
      "invalid_reward",
      "Invalid LEAF amount for this Deed",
      422,
    );
  }
  if (m.includes("FENN_INVALID_REVIEW_NOTE")) {
    return new DeedModerationRpcError(
      "invalid_review_note",
      "Review note is required",
      422,
    );
  }
  if (m.includes("FENN_LEDGER_CONFLICT")) {
    return new DeedModerationRpcError(
      "ledger_conflict",
      "Existing LEAF ledger conflicts with this submission",
      409,
    );
  }
  if (m.includes("FENN_PROFILE_NOT_FOUND")) {
    return new DeedModerationRpcError(
      "profile_not_found",
      "Profile not found",
      404,
    );
  }

  return new DeedModerationRpcError(
    "rpc_failed",
    "Deed moderation RPC failed",
    500,
  );
}
