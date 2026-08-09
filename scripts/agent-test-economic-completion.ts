/**
 * Stage P1E ops CLI — dry-run economic completion speech + effect plan.
 *
 *   npm run agent:test-economic-completion -- --label demo
 *   npm run agent:test-economic-completion -- --transfer-amount 25000 --burn-amount 50000
 */

import { runP1eEconomicCompletionHarness } from "@/lib/agent/p1e-economic-completion-test";

function parseArgs(argv: string[]): {
  label: string;
  transferAmount: string;
  burnAmount: string;
  wallet: string;
} {
  let label = "p1e-demo";
  let transferAmount = "25000";
  let burnAmount = "50000";
  let wallet = "0x92a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab174";
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--label" || a === "--op") {
      label = argv[i + 1] ?? label;
      i += 1;
    } else if (a === "--transfer-amount") {
      transferAmount = argv[i + 1] ?? transferAmount;
      i += 1;
    } else if (a === "--burn-amount") {
      burnAmount = argv[i + 1] ?? burnAmount;
      i += 1;
    } else if (a === "--wallet") {
      wallet = argv[i + 1] ?? wallet;
      i += 1;
    }
  }
  return { label, transferAmount, burnAmount, wallet };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runP1eEconomicCompletionHarness({
    label: args.label,
    transferAmount: args.transferAmount,
    burnAmount: args.burnAmount,
    recipientAddress: args.wallet,
    forceSpeechFallback: true,
  });
  console.log(
    JSON.stringify(
      {
        warning:
          "P1E economic-completion dry-run — no X posts; no chain broadcast",
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
    "[agent:test-economic-completion] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
