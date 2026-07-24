import type { RetrievedFennKnowledge } from "@/lib/memory/retrieve";

/**
 * Defence-in-depth: public_agent may only keep visibility=public
 * canon / greenwood_memory rows.
 */
export function filterPublicAgentKnowledgeResults(
  results: readonly RetrievedFennKnowledge[],
): RetrievedFennKnowledge[] {
  return results.filter(
    (r) =>
      r.visibility === "public" &&
      (r.layer === "canon" || r.layer === "greenwood_memory") &&
      typeof r.text === "string" &&
      r.text.trim().length > 0,
  );
}
