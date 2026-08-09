/**
 * Full disposable MVP economic flow rehearsal CLI.
 *
 * Dry-run (default — model + P1D wallet FSM + speech previews, no chain, no live X):
 *
 *   npm run agent:rehearse-economic-flow -- \
 *     --text "I reported the issue." \
 *     --trusted-fact "FENN operators verified a consequential security contribution." \
 *     --reference-id rehearsal-security-001 \
 *     --wallet 0x92a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab174 \
 *     --confirm yes \
 *     --operation-label full-rehearsal-001
 *
 * Disposable chain execution (explicit opt-in only):
 *
 *   npm run agent:rehearse-economic-flow -- \
 *     --text "…" --trusted-fact "…" --wallet 0x… --confirm yes \
 *     --operation-label full-rehearsal-001 \
 *     --execute-test
 *
 * Requires FENN_PURSE_TEST_MODE=explicit_allow + test token + private key + RPC.
 * Never posts to live @askfenn. Never uses official FENN.
 */

import {
  runMvpEconomicRehearsal,
} from "@/lib/agent/mvp-economic-rehearsal";
import {
  attestationFromHarnessText,
} from "@/lib/agent/economic-attestation";

function parseArgs(argv: string[]): {
  text: string | null;
  operationLabel: string | null;
  trustedFact: string | null;
  referenceId: string | null;
  wallet: string | null;
  confirm: string;
  executeTest: boolean;
  forceFallback: boolean;
} {
  let text: string | null = null;
  let operationLabel: string | null = null;
  let trustedFact: string | null = null;
  let referenceId: string | null = null;
  let wallet: string | null = null;
  let confirm = "yes";
  let executeTest = false;
  let forceFallback = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--text") {
      text = argv[i + 1] ?? null;
      i += 1;
    } else if (
      a === "--operation-label" ||
      a === "--label" ||
      a === "--op"
    ) {
      operationLabel = argv[i + 1] ?? null;
      i += 1;
    } else if (a === "--trusted-fact") {
      trustedFact = argv[i + 1] ?? null;
      i += 1;
    } else if (a === "--reference-id" || a === "--ref") {
      referenceId = argv[i + 1] ?? null;
      i += 1;
    } else if (a === "--wallet") {
      // USER TURN 1 content — never Stage 12.4 trusted wallet.
      wallet = argv[i + 1] ?? null;
      i += 1;
    } else if (a === "--confirm") {
      confirm = argv[i + 1] ?? "yes";
      i += 1;
    } else if (a === "--execute-test") {
      executeTest = true;
    } else if (a === "--force-fallback") {
      forceFallback = true;
    } else if (a === "--trusted-wallet") {
      throw new Error(
        "mvp_rehearsal_trusted_wallet_forbidden: use --wallet as user turn 1 (untrusted until P1D confirms)",
      );
    } else if (a === "--force-intent") {
      throw new Error(
        "mvp_rehearsal_force_intent_forbidden: FENN must independently judge",
      );
    }
  }

  return {
    text,
    operationLabel,
    trustedFact,
    referenceId,
    wallet,
    confirm,
    executeTest,
    forceFallback,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.text?.trim()) {
    console.error("Usage: --text <untrusted X text> is required");
    process.exitCode = 1;
    return;
  }
  if (!args.operationLabel?.trim()) {
    console.error("Usage: --operation-label <label> is required");
    process.exitCode = 1;
    return;
  }

  const attestation =
    args.trustedFact?.trim()
      ? attestationFromHarnessText({
          referenceId:
            args.referenceId?.trim() ||
            `rehearsal-${args.operationLabel.trim()}`,
          summary: args.trustedFact.trim(),
        })
      : null;

  const result = await runMvpEconomicRehearsal({
    operationLabel: args.operationLabel,
    text: args.text,
    attestation,
    walletText: args.wallet,
    confirmText: args.confirm,
    executeTest: args.executeTest,
    forceSpeechFallback: args.forceFallback,
  });

  console.log(
    JSON.stringify(
      {
        warning: args.executeTest
          ? "MVP FULL DISPOSABLE REHEARSAL — durable rows + Stage 12.6 + test rail. No live X posts."
          : "MVP FULL REHEARSAL dry-run — real model judgement; no chain; no live X posts.",
        liveXPostNote:
          "To attempt a live test-rail X post later (not this command), operators would need FENN_P1E_ALLOW_TEST_FOLLOWUP_X=explicit_allow separately. Default rehearsal never sets that.",
        ...result,
      },
      null,
      2,
    ),
  );

  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    "[agent:rehearse-economic-flow] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
