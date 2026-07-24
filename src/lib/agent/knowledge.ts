import "server-only";

import {
  FENN_PUBLIC_AGENT_RETRIEVE_LIMIT,
  FENN_PUBLIC_AGENT_RETRIEVE_TIMEOUT_MS,
} from "@/lib/agent/config";
import { filterPublicAgentKnowledgeResults } from "@/lib/agent/public-filter";
import {
  retrieveFennKnowledge,
  type RetrievedFennKnowledge,
} from "@/lib/memory/retrieve";

/**
 * Distinguishes "nothing relevant" from "brain lookup failed".
 * Stage 12 should be more conservative when available=false.
 */
export type PublicAgentKnowledgeLookup = {
  available: boolean;
  results: RetrievedFennKnowledge[];
};

export type PublicAgentKnowledgeRetriever = (input: {
  query: string;
  scope: "public_agent";
  limit?: number;
}) => Promise<RetrievedFennKnowledge[]>;

/**
 * Trusted public-agent knowledge lookup.
 * Scope is fixed to "public_agent" — callers cannot choose camp/internal.
 */
export async function safeRetrievePublicAgentKnowledge(input: {
  query: string;
  retrieve?: PublicAgentKnowledgeRetriever;
  timeoutMs?: number;
}): Promise<PublicAgentKnowledgeLookup> {
  const query = input.query.trim();
  if (!query) {
    return { available: true, results: [] };
  }

  const timeoutMs = input.timeoutMs ?? FENN_PUBLIC_AGENT_RETRIEVE_TIMEOUT_MS;
  const retrieve =
    input.retrieve ??
    ((args: { query: string; scope: "public_agent"; limit?: number }) =>
      retrieveFennKnowledge({
        query: args.query,
        scope: "public_agent",
        limit: args.limit ?? FENN_PUBLIC_AGENT_RETRIEVE_LIMIT,
      }));

  try {
    const raw = await Promise.race([
      retrieve({
        query,
        scope: "public_agent",
        limit: FENN_PUBLIC_AGENT_RETRIEVE_LIMIT,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("public_agent_knowledge_timeout")),
          timeoutMs,
        );
      }),
    ]);

    const results = filterPublicAgentKnowledgeResults(
      Array.isArray(raw) ? raw : [],
    );
    return { available: true, results };
  } catch {
    return { available: false, results: [] };
  }
}
