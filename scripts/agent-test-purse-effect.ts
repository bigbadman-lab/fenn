/**
 * Stage P1A ops CLI: controlled transfer_fenn Stage 12 effect → Purse settlement.
 *
 * Usage:
 *   npm run agent:test-purse-effect -- --to 0xRecipient --operation-label p1a-001
 *   npm run agent:test-purse-effect -- --to 0xRecipient --operation-label p1a-001 --dry-run
 *
 * Proves:
 *   Stage 12 effect → 12.6 claim/dispatch → Purse adapter → P0 settlement
 *
 * Never posts to X. Never invents a second settlement engine.
 * Disposable-token rail requires FENN_PURSE_TEST_MODE=explicit_allow (+ token envs).
 * Private key is never printed.
 */

import { runP1aPurseEffectTest } from "@/lib/agent/p1a-purse-effect-test";
import { stage12TransferPurseOperationId } from "@/lib/agent/authority-config";

function parseArgs(argv: string[]): {
  to: string | null;
  operationLabel: string | null;
  dryRun: boolean;
} {
  let to: string | null = null;
  let operationLabel: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--to" || arg === "--recipient") {
      to = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--operation-label" || arg === "--label" || arg === "--op") {
      operationLabel = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
    }
  }
  return { to, operationLabel, dryRun };
}

async function main() {
  const { to, operationLabel, dryRun } = parseArgs(process.argv.slice(2));
  if (!to || !operationLabel) {
    console.error(
      [
        "Usage:",
        "  npm run agent:test-purse-effect -- --to 0xRecipient --operation-label p1a-001",
        "  npm run agent:test-purse-effect -- --to 0xRecipient --operation-label p1a-001 --dry-run",
        "",
        "Amount is fixed to 1 disposable test token (executionRail=p1a_test).",
        "Requires FENN_PURSE_TEST_MODE=explicit_allow + test token envs.",
        "Refuses production hosts and refuses once official FENN resolves.",
        "Private key is never printed.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const result = await runP1aPurseEffectTest({
    recipientAddress: to,
    operationLabel,
    dryRun,
  });

  const operationId = result.effectId
    ? stage12TransferPurseOperationId(result.effectId)
    : null;

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        status: result.status,
        mode: "P1A_TEST",
        warning: "NOT OFFICIAL FENN — Stage 12 transfer_fenn via disposable rail",
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
    "[agent:test-purse-effect] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
