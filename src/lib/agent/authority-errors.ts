export type AuthorityErrorCode =
  | "authority_claim_failed"
  | "authority_persist_failed"
  | "authority_invalid_input"
  | "authority_not_found";

export class AuthorityError extends Error {
  code: AuthorityErrorCode;
  status: number;

  constructor(code: AuthorityErrorCode, message: string, status = 500) {
    super(message);
    this.name = "AuthorityError";
    this.code = code;
    this.status = status;
  }
}
