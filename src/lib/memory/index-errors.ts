export type MemoryIndexErrorCode =
  | "memory_index_failed"
  | "memory_index_not_found"
  | "memory_index_not_eligible"
  | "memory_index_stale_parent"
  | "memory_embed_unavailable"
  | "memory_embed_timeout"
  | "memory_embed_failed"
  | "memory_embed_invalid_dimension";

export class MemoryIndexError extends Error {
  code: MemoryIndexErrorCode;
  status: number;

  constructor(code: MemoryIndexErrorCode, message: string, status = 500) {
    super(message);
    this.name = "MemoryIndexError";
    this.code = code;
    this.status = status;
  }
}
