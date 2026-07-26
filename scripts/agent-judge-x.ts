/**
 * Trusted ops: judge pending X perceptions (intention only).
 *
 * Usage:
 *   npm run agent:judge-x
 *   npm run agent:judge-x -- --limit=3
 *
 * Does not post to X, write the Wall, or call live tools.
 */

import {
  formatJudgeBatchReport,
  judgePendingXPerceptions,
} from "@/lib/agent/judge";
import { STAGE12_JUDGE_BATCH_DEFAULT } from "@/lib/agent/judge-config";

function parseLimit(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--limit="));
  if (!flag) return STAGE12_JUDGE_BATCH_DEFAULT;
  const n = Number(flag.slice("--limit=".length));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : STAGE12_JUDGE_BATCH_DEFAULT;
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const result = await judgePendingXPerceptions({ limit });
  console.log(formatJudgeBatchReport(result));
  if (result.failed > 0 && result.judged === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[agent:judge-x] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
