/**
 * Stage 13.1 — canonical one-shot X agent production runtime.
 *
 * Usage:
 *   npm run agent:run-x
 *
 * Bounded execution: mode gate → lease → poll→judge→sight→authorize→execute → exit.
 * Suitable for Render Cron Jobs (schedule * * * * *). Never a long-running server.
 */

import { validateXAgentRuntimeEnv } from "@/lib/ops/x-runtime-env";

async function main() {
  validateXAgentRuntimeEnv();

  // Dynamic import so env validation runs before serverEnv / stage modules load.
  const { runXAgentProductionCycle } = await import(
    "@/lib/ops/x-agent-production-runtime"
  );
  const result = await runXAgentProductionCycle();
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[agent:run-x] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
