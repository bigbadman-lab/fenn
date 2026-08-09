/**
 * P2A — dedicated production Purse Executor entrypoint.
 *
 * Usage:
 *   npm run purse:settle
 *
 * Claims ONLY transfer_fenn / burn_fenn.
 * Requires FENN_PURSE_PRIVATE_KEY when official FENN is active and work exists.
 * Does not require X OAuth or OpenAI.
 * Suitable for Render Cron (once per minute).
 */

import { loadLocalEnvIfPresent } from "@/lib/ops/load-local-env";
import { validatePurseExecutorRuntimeEnv } from "@/lib/ops/purse-executor-env";

async function main() {
  // Local: fill missing keys from .env.local. Render: no-op (process.env wins).
  // Also present via package.json --import; keep in-script for path clarity.
  loadLocalEnvIfPresent();

  // Always validate the live process.env (never a reconstructed empty map).
  validatePurseExecutorRuntimeEnv(process.env);

  const { runPurseExecutorCycle } = await import(
    "@/lib/ops/purse-executor-runtime"
  );
  const result = await runPurseExecutorCycle();
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[purse:settle] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
