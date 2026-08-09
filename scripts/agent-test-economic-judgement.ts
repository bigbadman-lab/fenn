/**
 * Stage P1B.1/P1B.2 ops CLI: real economic judgement + optional model-originated execution.
 *
 * Default: calibration dry-run (real Stage 12.4 model + authority preview).
 *
 * P1B.2 model-originated disposable-rail execution:
 *   npm run agent:test-economic-judgement -- \
 *     --text "I reported the issue." \
 *     --trusted-wallet 0x… \
 *     --trusted-fact "FENN operators verified …" \
 *     --operation-label p1b2-model-transfer-001 \
 *     --execute-model-intent
 *
 * Never use --force-intent for the model-originated chain proof.
 */

import {
  runP1bEconomicJudgementTest,
} from "@/lib/agent/p1b-economic-judgement-test";
import {
  attestationFromHarnessText,
  parseTrustedEconomicAttestation,
} from "@/lib/agent/economic-attestation";
import type { FinalEconomicIntent } from "@/lib/agent/economic-intent";

function parseArgs(argv: string[]): {
  text: string | null;
  operationLabel: string | null;
  trustedWallet: string | null;
  trustedFact: string | null;
  trustedFactJson: string | null;
  referenceId: string | null;
  forceIntent: "none" | "transfer" | "burn" | null;
  dryRun: boolean;
  execute: boolean;
  executeModelIntent: boolean;
} {
  let text: string | null = null;
  let operationLabel: string | null = null;
  let trustedWallet: string | null = null;
  let trustedFact: string | null = null;
  let trustedFactJson: string | null = null;
  let referenceId: string | null = null;
  let forceIntent: "none" | "transfer" | "burn" | null = null;
  let dryRun = false;
  let execute = false;
  let executeModelIntent = false;
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
    if (arg === "--trusted-fact") {
      trustedFact = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--trusted-fact-json") {
      trustedFactJson = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--reference-id" || arg === "--ref") {
      referenceId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--force-intent") {
      const v = (argv[i + 1] ?? "none").toLowerCase();
      if (v === "transfer" || v === "burn" || v === "none") forceIntent = v;
      i += 1;
      continue;
    }
    if (arg === "--intent") {
      const v = (argv[i + 1] ?? "none").toLowerCase();
      if (v === "transfer" || v === "burn" || v === "none") forceIntent = v;
      i += 1;
      continue;
    }
    if (arg === "--dry-run") dryRun = true;
    if (arg === "--execute") execute = true;
    if (arg === "--execute-model-intent") executeModelIntent = true;
  }
  return {
    text,
    operationLabel,
    trustedWallet,
    trustedFact,
    trustedFactJson,
    referenceId,
    forceIntent,
    dryRun,
    execute,
    executeModelIntent,
  };
}

function buildForceIntent(
  intent: "none" | "transfer" | "burn",
): FinalEconomicIntent {
  if (intent === "transfer") {
    return {
      type: "transfer_fenn",
      reason: "operator force-intent (not model judgement)",
      recipientSource: "trusted_profile_wallet",
    };
  }
  if (intent === "burn") {
    return {
      type: "burn_fenn",
      reason: "operator force-intent (not model judgement)",
    };
  }
  return { type: "NONE" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.text || !args.operationLabel) {
    console.error(
      [
        "Usage (real model calibration — default dry-run):",
        "  npm run agent:test-economic-judgement -- \\",
        "    --text \"…\" --operation-label calibration-001 --dry-run",
        "",
        "P1B.2 model-originated disposable test-rail execution:",
        "  npm run agent:test-economic-judgement -- \\",
        "    --text \"I reported the issue.\" \\",
        "    --trusted-wallet 0x… \\",
        "    --trusted-fact \"FENN operators verified …\" \\",
        "    --reference-id security-live-test-001 \\",
        "    --operation-label p1b2-model-transfer-001 \\",
        "    --execute-model-intent",
        "",
        "Force intent (authority only — NOT model judgement):",
        "  … --force-intent transfer --trusted-wallet 0x… --dry-run",
        "",
        "Rules:",
        "  - Default never broadcasts.",
        "  - --execute-model-intent never with --force-intent.",
        "  - Model may choose NONE → no transaction (success: no_economic_action).",
        "  - Fresh operation-label for a new model sample.",
        "  - Disposable rail only (FENN_PURSE_TEST_MODE=explicit_allow).",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  if (args.executeModelIntent && args.forceIntent != null) {
    console.error(
      "[agent:test-economic-judgement] --execute-model-intent is incompatible with --force-intent",
    );
    process.exitCode = 1;
    return;
  }

  let attestation = null;
  try {
    if (args.trustedFactJson) {
      attestation = parseTrustedEconomicAttestation(
        JSON.parse(args.trustedFactJson) as unknown,
      );
    } else if (args.trustedFact) {
      attestation = attestationFromHarnessText({
        summary: args.trustedFact,
        referenceId: args.referenceId,
      });
    }
  } catch (error) {
    console.error(
      "[agent:test-economic-judgement] invalid trusted fact",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    return;
  }

  const forceIntent =
    args.forceIntent != null ? buildForceIntent(args.forceIntent) : null;

  // Legacy --execute: force-intent path only (not model).
  const forceExecute =
    Boolean(args.execute) &&
    !args.executeModelIntent &&
    forceIntent != null &&
    args.forceIntent !== "none";
  if (args.execute && !forceExecute && !args.executeModelIntent) {
    console.error(
      "[agent:test-economic-judgement] --execute alone is not valid; use --execute-model-intent (model) or --execute with --force-intent (ops)",
    );
    process.exitCode = 1;
    return;
  }

  const result = await runP1bEconomicJudgementTest({
    operationLabel: args.operationLabel,
    text: args.text,
    trustedWallet: args.trustedWallet,
    attestation,
    forceIntent,
    dryRun: args.executeModelIntent || forceExecute ? false : true,
    execute: forceExecute,
    executeModelIntent: args.executeModelIntent,
  });

  const warning =
    result.mode === "MODEL_JUDGEMENT_EXECUTION_TEST"
      ? "P1B.2 model-originated execution — disposable rail only; intentForced must be false"
      : result.mode === "model_judgement"
        ? "P1B.1 calibration — real Stage 12.4 model judgement; no claim/broadcast"
        : "P1B force-intent — operator bypass; NOT model economic judgement";

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        status: result.status,
        mode: result.mode,
        intentForced: result.intentForced,
        dryRun: result.dryRun,
        claimAttempted: result.claimAttempted,
        broadcastAttempted: result.broadcastAttempted,
        warning,
        operationLabel: result.operationLabel,
        runNonce: result.runNonce ?? null,
        xPostId: result.xPostId ?? null,
        untrustedText: result.untrustedText ?? null,
        trustedWalletAvailable: result.trustedWalletAvailable,
        trustedWallet: result.trustedWallet ?? null,
        trustedAttestation: result.trustedAttestation
          ? {
              referenceId: result.trustedAttestation.referenceId,
              summary: result.trustedAttestation.summary,
              verified: true,
              impactContext: result.trustedAttestation.impactContext ?? null,
            }
          : null,
        modelEconomicAction: result.modelEconomicAction ?? null,
        speechAction: result.speechAction ?? null,
        authorityOutcome: result.authorityOutcome ?? null,
        policyCode: result.policyCode ?? null,
        authorityPlannedEffects: result.authorityPlannedEffects ?? [],
        economicExecutionEligible: result.economicExecutionEligible ?? false,
        effectId: result.effectId ?? null,
        purseOperationId: result.purseOperationId ?? null,
        externalResultId: result.externalResultId ?? null,
        economicFollowupPreview: result.economicFollowupPreview ?? null,
        isTest: result.isTest ?? null,
        copyForwardNote: result.copyForwardNote ?? null,
        errorCode: result.errorCode ?? null,
        providerFailure: result.providerFailure ?? null,
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
