/**
 * Stage P1D ops CLI — multi-turn wallet collection dry-run harness (in-memory).
 *
 *   npm run agent:test-wallet-collection -- --label demo
 *   npm run agent:test-wallet-collection -- --amount 25000 --wallet 0x… --confirm yes
 */

import { runP1dWalletCollectionHarness } from "@/lib/agent/p1d-wallet-collection-test";

function parseArgs(argv: string[]): {
  label: string;
  amount: string;
  wallet: string;
  confirm: string;
  poison: boolean;
} {
  let label = "p1d-demo";
  let amount = "25000";
  let wallet = "0x92a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab174";
  let confirm = "yes";
  let poison = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--label" || a === "--op") {
      label = argv[i + 1] ?? label;
      i += 1;
    } else if (a === "--amount") {
      amount = argv[i + 1] ?? amount;
      i += 1;
    } else if (a === "--wallet") {
      wallet = argv[i + 1] ?? wallet;
      i += 1;
    } else if (a === "--confirm") {
      confirm = argv[i + 1] ?? confirm;
      i += 1;
    } else if (a === "--poison-wallet-user") {
      poison = true;
    }
  }
  return { label, amount, wallet, confirm, poison };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const other = "9199999999999999999";
  const result = runP1dWalletCollectionHarness({
    label: args.label,
    proposedAmount: args.amount,
    turns: [args.wallet, args.confirm],
    turnAuthors: args.poison ? [other, null] : undefined,
    dryRun: true,
  });

  console.log(
    JSON.stringify(
      {
        warning:
          "P1D wallet-collection dry-run — in-memory; no X posts; no chain broadcast",
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
    "[agent:test-wallet-collection] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
