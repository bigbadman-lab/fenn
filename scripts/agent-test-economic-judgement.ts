/**
 * Stage P1B ops CLI: controlled economic judgement → authority (→ optional execute).
 *
 * Usage:
 *   npm run agent:test-economic-judgement -- --text "..." --operation-label p1b-001 --dry-run
 *   npm run agent:test-economic-judgement -- --text "..." --operation-label p1b-001 --intent burn --dry-run
 *   npm run agent:test-economic-judgement -- --text "..." --trusted-wallet 0x... --intent transfer --dry-run
 *
 * Live execute (disposable rail) requires --execute and armed test envs.
 * Private key never printed. Ordinary X traffic cannot use this rail.
 */

import { runP1bEconomicJudgementTest } from "@/lib/agent/p1b-economic-judgement-test";
import type { FinalEconomicIntent } from "@/lib/agent/economic-intent";

function parseArgs(argv: string[]): {
  text: string | null;
  operationLabel: string | null;
  trustedWallet: string | null;
  intent: "none" | "transfer" | "burn";
  dryRun: boolean;
  execute: boolean;
} {
  let text: string | null = null;
  let operationLabel: string | null = null;
  let trustedWallet: string | null = null;
  let intent: "none" | "transfer" | "burn" = "none";
  let dryRun = false;
  let execute = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--text") {
      text = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--operation-label" || arg === "--label" || arg === "--op") {
      operationLabel = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--trusted-wallet" || arg === "--wallet") {
      trustedWallet = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--intent") {
      const v = (argv[i + 1] ?? "none").toLowerCase();
      if (v === "transfer" || v === "burn" || v === "none") intent = v;
      i += 1;
      continue;
    }
    if (arg === "--dry-run") dryRun = true;
    if (arg === "--execute") execute = true;
  }
  return { text, operationLabel, trustedWallet, intent, dryRun, execute };
}

function buildIntent(
  intent: "none" | "transfer" | "burn",
): FinalEconomicIntent {
  if (intent === "transfer") {
    return {
      type: "transfer_fenn",
      reason: "operator-injected p1b intent for controlled test",
      recipientSource: "trusted_profile_wallet",
    };
  }
  if (intent === "burn") {
    return {
      type: "burn_fenn",
      reason: "operator-injected p1b burn intent for controlled test",
    };
  }
  return { type: "NONE" };
}

async function main() {
  const { text, operationLabel, trustedWallet, intent, dryRun, execute } =
    parseArgs(process.argv.slice(2));
  if (!text || !operationLabel) {
    console.error(
      [
        "Usage:",
        "  npm run agent:test-economic-judgement -- --text \"...\" --operation-label p1b-001 --dry-run",
        "  npm run agent:test-economic-judgement -- --text \"...\" --label p1b-001 --intent burn --dry-run",
        "  npm run agent:test-economic-judgement -- --text \"...\" --trusted-wallet 0x… --intent transfer --dry-run",
        "",
        "Default: dry-run authority preview (no broadcast).",
        "Add --execute to run Stage 12.6 with disposable p1a_test rail (requires test envs).",
        "Amount is always 1. Model fields never choose token/chain/dead address.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const result = await runP1bEconomicJudgementTest({
    operationLabel,
    text,
    trustedWallet,
    economicIntent: buildIntent(intent),
    dryRun: dryRun || !execute,
    execute: execute && !dryRun,
  });

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        status: result.status,
        mode: "P1B_ECONOMIC_JUDGEMENT",
        warning:
          "Controlled P1B harness — disposable rail only when --execute; NOT ordinary live X traffic",
        operationLabel: result.operationLabel,
        xPostId: result.xPostId ?? null,
        economicIntent: result.economicIntent ?? null,
        authorityOutcome: result.authorityOutcome ?? null,
        policyCode: result.policyCode ?? null,
        effectTypes: result.effectTypes ?? [],
        externalResultId: result.externalResultId ?? null,
        economicFollowupPreview: result.economicFollowupPreview ?? null,
        errorCode: result.errorCode ?? null,
        durationMs: result.durationMs,
      },
      null,
      2,
    ),
  );

  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    "[agent:test-economic-judgement] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
