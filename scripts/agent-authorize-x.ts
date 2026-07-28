/**
 * Trusted ops: authorise finalized X intentions into pending effects.
 *
 * Usage:
 *   npm run agent:authorize-x
 *   npm run agent:authorize-x -- --limit=3
 *
 * Deterministic. 0 OpenAI. 0 live reads. Does not execute consequences.
 */

import {
  authorizePendingXPerceptions,
  formatAuthorizeBatchReport,
} from "@/lib/agent/stage125-authorize";
import { STAGE125_AUTHORITY_BATCH_DEFAULT } from "@/lib/agent/authority-config";

function parseLimit(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--limit="));
  if (!flag) return STAGE125_AUTHORITY_BATCH_DEFAULT;
  const n = Number(flag.slice("--limit=".length));
  return Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : STAGE125_AUTHORITY_BATCH_DEFAULT;
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const result = await authorizePendingXPerceptions({ limit });
  console.log(formatAuthorizeBatchReport(result));
  if (result.failed > 0 && result.authorised === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[agent:authorize-x] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
