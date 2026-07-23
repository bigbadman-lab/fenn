import { MemoryRetrieveError } from "@/lib/memory/retrieve-errors";

/**
 * Application-controlled retrieval scopes.
 * Callers may not pass raw visibility arrays.
 */
export type FennKnowledgeScope = "public_agent" | "camp" | "internal";

export const FENN_KNOWLEDGE_SCOPES = [
  "public_agent",
  "camp",
  "internal",
] as const satisfies readonly FennKnowledgeScope[];

/** Visibility allowlist per scope (must match SQL search_fenn_memory_chunks). */
export const FENN_SCOPE_VISIBILITY: Record<
  FennKnowledgeScope,
  readonly ("public" | "camp" | "internal")[]
> = {
  public_agent: ["public"],
  camp: ["public", "camp"],
  internal: ["public", "camp", "internal"],
};

export function parseFennKnowledgeScope(raw: unknown): FennKnowledgeScope {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new MemoryRetrieveError(
      "memory_retrieve_invalid_scope",
      "Retrieval scope is required",
      400,
    );
  }
  const scope = raw.trim() as FennKnowledgeScope;
  if (!(FENN_KNOWLEDGE_SCOPES as readonly string[]).includes(scope)) {
    throw new MemoryRetrieveError(
      "memory_retrieve_invalid_scope",
      "Invalid retrieval scope",
      400,
    );
  }
  return scope;
}

export function scopeAllowsVisibility(
  scope: FennKnowledgeScope,
  visibility: string,
): boolean {
  return (FENN_SCOPE_VISIBILITY[scope] as readonly string[]).includes(
    visibility,
  );
}
