/**
 * Trusted ops: index / reindex active FENN knowledge chunks + embeddings.
 *
 * Usage:
 *   npm run memory:index
 *
 * Logs aggregates and memory IDs only — never raw memory bodies or vectors.
 * Canon sync and memory approval remain independent of this command.
 */

import { processPendingMemoryIndex } from "@/lib/memory/process-index";

async function main() {
  const force = process.argv.includes("--force");
  const result = await processPendingMemoryIndex({ force });
  console.log("[memory:index] ok", {
    scanned: result.scanned,
    indexed: result.indexed,
    unchanged: result.unchanged,
    cleared: result.cleared,
    skipped: result.skipped,
    failed: result.failed,
    force,
  });
  if (result.failed > 0 && result.indexed === 0 && result.unchanged === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[memory:index] failed", error);
  process.exitCode = 1;
});
