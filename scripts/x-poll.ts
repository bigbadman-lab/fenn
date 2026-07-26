/**
 * Trusted ops: poll X mentions and persist perceptions idempotently.
 *
 * Usage:
 *   npm run x:poll
 *
 * Logs aggregate counts only — never tokens or full mention bodies.
 */

import { formatXPollReport, pollXMentions } from "@/lib/x/poll";

async function main() {
  const result = await pollXMentions();
  console.log(formatXPollReport(result));
  if (result.failed > 0 && result.created + result.existing === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[x:poll] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
