export type WallErrorCode =
  | "wall_invalid_body"
  | "wall_invalid_source"
  | "wall_idempotency_conflict"
  | "wall_read_failed"
  | "wall_write_failed"
  | "wall_not_found"
  | "wall_entry_not_found"
  | "wall_mark_failed"
  | "wall_invalid_entry_id";

export class WallError extends Error {
  code: WallErrorCode;
  status: number;

  constructor(code: WallErrorCode, message: string, status = 400) {
    super(message);
    this.name = "WallError";
    this.code = code;
    this.status = status;
  }
}
