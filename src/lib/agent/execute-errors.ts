export type ExecuteErrorCode =
  | "execute_claim_failed"
  | "execute_persist_failed"
  | "execute_invalid_payload"
  | "execute_x_failed"
  | "execute_wall_failed"
  | "execute_not_found";

export class ExecuteError extends Error {
  code: ExecuteErrorCode;
  status: number;

  constructor(code: ExecuteErrorCode, message: string, status = 500) {
    super(message);
    this.name = "ExecuteError";
    this.code = code;
    this.status = status;
  }
}
