/**
 * Stage P1A.1 ops CLI: controlled burn_fenn Stage 12 effect → dead-address Purse settlement.
 *
 * Usage:
 *   npm run agent:test-purse-burn -- --operation-label p1a-burn-001
 *   npm run agent:test-purse-burn -- --operation-label p1a-burn-001 --dry-run
 *
 * No --to / amount: destination is FENN_DEAD_ADDRESS in server code; amount is fixed "1".
 * Private key is never printed.
 */

import { runP1aPurseBurnTest } from "@/lib/agent/p1a-purse-burn-test";
import { stage12BurnPurseOperationId } from "@/lib/agent/authority-config";
import { FENN_DEAD_ADDRESS } from "@/lib/purse/constants";

function parseArgs(argv: string[]): {
  operationLabel: string | null;
  dryRun: boolean;
} {
  let operationLabel: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--operation-label" || arg === "--label" || arg === "--op") {
      operationLabel = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
    }
  }
  return { operationLabel, dryRun };
}

async function main() {
  const { operationLabel, dryRun } = parseArgs(process.argv.slice(2));
  if (!operationLabel) {
    console.error(
      [
        "Usage:",
        "  npm run agent:test-purse-burn -- --operation-label p1a-burn-001",
        "  npm run agent:test-purse-burn -- --operation-label p1a-burn-001 --dry-run",
        "",
        "Amount is fixed to 1 disposable test token (executionRail=p1a_test).",
        "Destination is the canonical dead address (server-owned; no --to).",
        "Requires FENN_PURSE_TEST_MODE=explicit_allow + test token envs.",
        "Private key is never printed.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const result = await runP1aPurseBurnTest({
    operationLabel,
    dryRun,
  });

  const operationId = result.effectId
    ? stage12BurnPurseOperationId(result.effectId)
    : null;

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        status: result.status,
        mode: "P1A1_BURN_TEST",
        warning:
          "NOT OFFICIAL FENN — Stage 12 burn_fenn via disposable rail (dead-address transfer, not ERC-20 burn())",
        deadAddress: FENN_DEAD_ADDRESS,
        effectId: result.effectId ?? null,
        xPostId: result.xPostId ?? null,
        operationLabel: result.operationLabel,
        purseOperationId: operationId,
        externalResultId: result.externalResultId ?? null,
        failureClass: result.failureClass ?? null,
        errorCode: result.errorCode ?? null,
        dryRunPreview: result.dryRunPreview ?? null,
        durationMs: result.durationMs,
      },
      null,
      2,
    ),
  );

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[agent:test-purse-burn] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
