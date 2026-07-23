/**
 * Trusted ops: process a bounded batch of pending memory candidates.
 *
 * Usage:
 *   npm run memory:process-pending
 *
 * Logs only aggregate counts — never raw Camp candidate text.
 */

import { processPendingMemoryCandidates } from "@/lib/memory/process";

async function main() {
  const result = await processPendingMemoryCandidates();
  console.log("[memory:process-pending] ok", {
    scanned: result.scanned,
    approved: result.approved,
    discarded: result.discarded,
    leftPending: result.leftPending,
    alreadyResolved: result.alreadyResolved,
    errors: result.errors,
  });
  if (result.errors > 0 && result.approved + result.discarded === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[memory:process-pending] failed", error);
  process.exitCode = 1;
});
