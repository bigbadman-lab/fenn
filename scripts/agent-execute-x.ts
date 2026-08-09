/**
 * Trusted ops: execute pending Stage 12.5 authorised effects.
 *
 * Usage:
 *   npm run agent:execute-x -- --list
 *   npm run agent:execute-x -- --dry-run
 *   npm run agent:execute-x -- --x-post-id=<id>
 *   npm run agent:execute-x -- --limit=1
 *   npm run agent:execute-x -- --economic   # intentional economic harness
 *
 * Defaults to speech-only claim scope (P2A). Does not accept reply/wall body
 * overrides. Executes persisted effects only.
 */

import {
  executePendingXPerceptionEffects,
  formatExecuteBatchReport,
  formatPendingEffectsReport,
} from "@/lib/agent/stage126-execute";
import { listPendingXPerceptionEffects } from "@/lib/agent/effect-persist";
import {
  STAGE126_ECONOMIC_EFFECT_TYPES,
  STAGE126_EXECUTE_BATCH_DEFAULT,
  STAGE126_SPEECH_EFFECT_TYPES,
} from "@/lib/agent/execute-config";

function parseLimit(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--limit="));
  if (!flag) return STAGE126_EXECUTE_BATCH_DEFAULT;
  const n = Number(flag.slice("--limit=".length));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : STAGE126_EXECUTE_BATCH_DEFAULT;
}

function parseXPostId(argv: string[]): string | undefined {
  const flag = argv.find((a) => a.startsWith("--x-post-id="));
  if (!flag) return undefined;
  const value = flag.slice("--x-post-id=".length).trim();
  return value.length > 0 ? value : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const listOnly = argv.includes("--list");
  const dryRun = argv.includes("--dry-run");
  // Ops: speech default. --economic for intentional economic harness only.
  const economic = argv.includes("--economic");
  const effectTypes = economic
    ? STAGE126_ECONOMIC_EFFECT_TYPES
    : STAGE126_SPEECH_EFFECT_TYPES;
  const xPostId = parseXPostId(argv);
  const limit = parseLimit(argv);

  if (listOnly) {
    const items = await listPendingXPerceptionEffects(Math.max(limit, 20), {
      effectTypes,
    });
    console.log(formatPendingEffectsReport(items));
    return;
  }

  const result = await executePendingXPerceptionEffects({
    limit,
    xPostId,
    dryRun,
    effectTypes,
  });
  console.log(formatExecuteBatchReport(result));
  if (result.failed > 0 && result.completed === 0 && result.dryRun === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[agent:execute-x] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
