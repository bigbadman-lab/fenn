/**
 * Stage 13.1 — canonical one-shot X agent production runtime.
 *
 * Usage:
 *   npm run agent:run-x
 *
 * Sequence: poll → judge → sight → authorize → execute.
 * Stops on fatal / hard-fail stage errors. Suitable for Render Cron Jobs.
 */

import { validateXAgentRuntimeEnv } from "@/lib/ops/x-runtime-env";

async function main() {
  validateXAgentRuntimeEnv();

  // Dynamic import so env validation runs before serverEnv / stage modules load.
  const { runXAgentPipeline } = await import("@/lib/ops/x-pipeline-runtime");
  const result = await runXAgentPipeline();
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
