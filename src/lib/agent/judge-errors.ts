export type AgentJudgeErrorCode =
  | "judge_unavailable"
  | "judge_invalid_response"
  | "judge_timeout"
  | "judge_persist_failed"
  | "judge_claim_failed"
  | "judge_not_found";

export class AgentJudgeError extends Error {
  code: AgentJudgeErrorCode;
  status: number;

  constructor(code: AgentJudgeErrorCode, message: string, status = 500) {
    super(message);
    this.name = "AgentJudgeError";
    this.code = code;
    this.status = status;
  }
}
