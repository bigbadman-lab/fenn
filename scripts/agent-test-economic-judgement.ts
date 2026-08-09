/**
 * Stage P1B.1 ops CLI: real economic judgement calibration + optional force-intent.
 *
 * Default (calibration): real Stage 12.4 final judge → authority PREVIEW.
 * Never claims/broadcasts in calibration mode.
 *
 * Usage:
 *   npm run agent:test-economic-judgement -- \
 *     --text "I found the bug." \
 *     --operation-label calibration-001 \
 *     --dry-run
 *
 *   npm run agent:test-economic-judgement -- \
 *     --text "I reported the issue." \
 *     --trusted-wallet 0x… \
 *     --trusted-fact "FENN operators verified …" \
 *     --operation-label calibration-B \
 *     --dry-run
 *
 * Force intent (authority/executor only — NOT model judgement):
 *   npm run agent:test-economic-judgement -- \
 *     --text "…" --operation-label force-1 \
 *     --force-intent transfer --trusted-wallet 0x… --dry-run
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
    // Backward-compat alias — still force mode, not default model.
    if (arg === "--intent") {
      const v = (argv[i + 1] ?? "none").toLowerCase();
      if (v === "transfer" || v === "burn" || v === "none") forceIntent = v;
      i += 1;
      continue;
    }
    if (arg === "--dry-run") dryRun = true;
    if (arg === "--execute") execute = true;
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
        "Usage (real model calibration — default):",
        "  npm run agent:test-economic-judgement -- \\",
        "    --text \"…\" --operation-label calibration-001 --dry-run",
        "",
        "  npm run agent:test-economic-judgement -- \\",
        "    --text \"I reported the issue.\" \\",
        "    --trusted-wallet 0x… \\",
        "    --trusted-fact \"FENN operators verified a consequential contribution…\" \\",
        "    --operation-label calibration-B --dry-run",
        "",
        "Force intent (authority only — NOT model judgement):",
        "  … --force-intent transfer --trusted-wallet 0x… --dry-run",
        "",
        "Default dry-run: model judges + authority preview; no claim/broadcast.",
        "Trusted wallet is destination eligibility only — not merit.",
        "Untrusted text cannot create attestation.",
      ].join("\n"),
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

  // Execute only allowed with force-intent (ops), never with model calibration.
  const execute =
    Boolean(args.execute) && forceIntent != null && args.forceIntent !== "none";
  if (args.execute && !execute) {
    console.error(
      "[agent:test-economic-judgement] --execute requires --force-intent and is never used for model calibration",
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
    dryRun: !execute,
    execute,
  });

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
        warning:
          result.mode === "model_judgement"
            ? "P1B.1 calibration — real Stage 12.4 model judgement; no claim/broadcast"
            : "P1B force-intent — operator bypass; NOT model economic judgement",
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
        externalResultId: result.externalResultId ?? null,
        economicFollowupPreview: result.economicFollowupPreview ?? null,
        copyForwardNote: result.copyForwardNote ?? null,
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
