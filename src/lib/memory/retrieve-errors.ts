export type MemoryRetrieveErrorCode =
  | "memory_retrieve_invalid_query"
  | "memory_retrieve_invalid_scope"
  | "memory_retrieve_invalid_limit"
  | "memory_retrieve_failed"
  | "memory_retrieve_embed_failed";

export class MemoryRetrieveError extends Error {
  code: MemoryRetrieveErrorCode;
  status: number;

  constructor(code: MemoryRetrieveErrorCode, message: string, status = 400) {
    super(message);
    this.name = "MemoryRetrieveError";
    this.code = code;
    this.status = status;
  }
}
