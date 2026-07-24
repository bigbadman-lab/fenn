import "server-only";

import {
  FENN_CAMP_RETRIEVE_LIMIT,
  FENN_CAMP_RETRIEVE_TIMEOUT_MS,
} from "@/lib/memory/context-config";
import {
  retrieveFennKnowledge,
  type RetrievedFennKnowledge,
  type RetrieveFennKnowledgeInput,
} from "@/lib/memory/retrieve";

export type CampKnowledgeRetriever = (
  input: Pick<RetrieveFennKnowledgeInput, "query" | "limit"> & {
    scope: "camp";
  },
) => Promise<RetrievedFennKnowledge[]>;

/**
 * Best-effort Camp retrieval. Always uses scope="camp".
 * Failures / timeouts return [] — never throw to Camp.
 */
export async function safeRetrieveCampKnowledge(input: {
  userMessage: string;
  retrieve?: CampKnowledgeRetriever;
  timeoutMs?: number;
}): Promise<RetrievedFennKnowledge[]> {
  const query = input.userMessage.trim();
  if (!query) return [];

  const timeoutMs = input.timeoutMs ?? FENN_CAMP_RETRIEVE_TIMEOUT_MS;
  const retrieve =
    input.retrieve ??
    ((args: { query: string; scope: "camp"; limit?: number }) =>
      retrieveFennKnowledge({
        query: args.query,
        scope: "camp",
        limit: args.limit ?? FENN_CAMP_RETRIEVE_LIMIT,
      }));

  try {
    const result = await Promise.race([
      retrieve({
        query,
        scope: "camp",
        limit: FENN_CAMP_RETRIEVE_LIMIT,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("camp_knowledge_timeout")), timeoutMs);
      }),
    ]);
    return Array.isArray(result) ? result : [];
  } catch {
    // Intentionally swallowed — Camp continues without knowledge context.
    return [];
  }
}
