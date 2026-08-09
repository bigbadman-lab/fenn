/**
 * Stage P1D ops CLI — multi-turn wallet collection dry-run harness (in-memory).
 *
 *   npm run agent:test-wallet-collection -- --label demo
 *   npm run agent:test-wallet-collection -- --amount 25000 --wallet 0x… --confirm yes
 *   npm run agent:test-wallet-collection -- --wallet 0xA… --confirm 0xB… --third-turn yes
 *   npm run agent:test-wallet-collection -- --wallet 0x… --confirm yes --expire-before-turn 1
 */

import { runP1dWalletCollectionHarness } from "@/lib/agent/p1d-wallet-collection-test";

function parseArgs(argv: string[]): {
  label: string;
  amount: string;
  wallet: string;
  confirm: string;
  thirdTurn: string | null;
  expireBeforeTurn: number | null;
  poison: boolean;
} {
  let label = "p1d-demo";
  let amount = "25000";
  let wallet = "0x92a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab174";
  let confirm = "yes";
  let thirdTurn: string | null = null;
  let expireBeforeTurn: number | null = null;
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
    } else if (a === "--third-turn") {
      thirdTurn = argv[i + 1] ?? "";
      i += 1;
    } else if (a === "--expire-before-turn") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n >= 1) {
        expireBeforeTurn = Math.floor(n);
      }
      i += 1;
    } else if (a === "--poison-wallet-user") {
      poison = true;
    }
  }
  return {
    label,
    amount,
    wallet,
    confirm,
    thirdTurn,
    expireBeforeTurn,
    poison,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const other = "9199999999999999999";
  const turns = [args.wallet, args.confirm];
  if (args.thirdTurn != null) {
    turns.push(args.thirdTurn);
  }

  let turnAuthors: Array<string | null> | undefined;
  if (args.poison) {
    turnAuthors = turns.map((_, i) => (i === 0 ? other : null));
  }

  const result = runP1dWalletCollectionHarness({
    label: args.label,
    proposedAmount: args.amount,
    turns,
    turnAuthors,
    dryRun: true,
    ...(args.expireBeforeTurn != null
      ? { expireBeforeTurn: args.expireBeforeTurn }
      : {}),
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
