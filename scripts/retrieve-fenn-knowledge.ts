/**
 * Trusted ops probe: scoped knowledge retrieval (Stage 11.5).
 *
 * Usage:
 *   npm run memory:retrieve -- --scope=internal "What is LEAF?"
 *   npm run memory:retrieve -- --scope=public_agent "What is The Wall?"
 *
 * Defaults to scope=internal. Outputs retrieval DTOs only (no vectors/provenance).
 * Development/operator tooling — not an HTTP API.
 */

import {
  parseFennKnowledgeScope,
  type FennKnowledgeScope,
} from "@/lib/memory/retrieve-scope";
import { retrieveFennKnowledge } from "@/lib/memory/retrieve";

function parseArgs(argv: string[]): {
  scope: FennKnowledgeScope;
  query: string;
  limit?: number;
} {
  let scope: FennKnowledgeScope = "internal";
  let limit: number | undefined;
  const parts: string[] = [];

  for (const arg of argv) {
    if (arg.startsWith("--scope=")) {
      scope = parseFennKnowledgeScope(arg.slice("--scope=".length));
      continue;
    }
    if (arg.startsWith("--limit=")) {
      limit = Number(arg.slice("--limit=".length));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        'Usage: npm run memory:retrieve -- [--scope=internal|camp|public_agent] [--limit=N] "query"',
      );
      process.exit(0);
    }
    parts.push(arg);
  }

  const query = parts.join(" ").trim();
  if (!query) {
    throw new Error("Query text is required");
  }
  return { scope, query, limit };
}

async function main() {
  const { scope, query, limit } = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const results = await retrieveFennKnowledge({ query, scope, limit });
  console.log("[memory:retrieve] ok", {
    scope,
    returned: results.length,
    durationMs: Date.now() - started,
  });
  console.log(
    JSON.stringify(
      results.map((r) => ({
        title: r.title,
        layer: r.layer,
        visibility: r.visibility,
        chunkIndex: r.chunkIndex,
        score: Number(r.score.toFixed(4)),
        memoryId: r.memoryId,
        textPreview: r.text.slice(0, 160),
      })),
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[memory:retrieve] failed", error);
  process.exitCode = 1;
});
