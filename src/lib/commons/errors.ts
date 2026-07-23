export type CommonsErrorCode =
  | "commons_read_failed"
  | "commons_malformed_amount"
  | "commons_empty";

export class CommonsError extends Error {
  code: CommonsErrorCode;
  status: number;

  constructor(code: CommonsErrorCode, message: string, status = 500) {
    super(message);
    this.name = "CommonsError";
    this.code = code;
    this.status = status;
  }
}
