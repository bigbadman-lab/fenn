/**
 * Trusted ops: finalize Stage 12.4 live-state-required judgements.
 *
 * This performs read-only live sight (treasury/commons/wall/deeds) and
 * persists a final intention. No actions execute.
 */

import { finalizePendingXPerceptionsWithLiveState, formatSightBatchReport } from "@/lib/agent/stage124-sight";

async function main() {
  const argv = process.argv.slice(2);
  const flag = argv.find((a) => a.startsWith("--limit="));
  const limit = flag ? Math.max(1, Math.floor(Number(flag.slice("--limit=".length)))) : undefined;

  const result = await finalizePendingXPerceptionsWithLiveState({ limit }, {});
  console.log(formatSightBatchReport(result));
  if (result.failed > 0 && result.finalized === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[agent:sight-x] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});

