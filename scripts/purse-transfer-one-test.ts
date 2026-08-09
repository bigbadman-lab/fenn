/**
 * Operator CLI: transfer exactly 1 disposable ERC-20 from THE PURSE (pre-launch).
 *
 * NEVER a public endpoint. NO autonomous agent behaviour. NOT official FENN.
 *
 * Usage:
 *   npm run purse:transfer-one-test -- --to 0xRecipient... --operation-id test:p0-manual-001
 *
 * Requires local env arming (FENN_PURSE_TEST_MODE=explicit_allow + token).
 * Refuses production hosts and refuses once official FENN resolves.
 * Safe preview is always printed first. Private key is never logged.
 */

import {
  buildManualTestTransferPreview,
  executeManualTestTransfer,
} from "@/lib/purse/transfer";
import { PurseError } from "@/lib/purse/errors";
import { P0_MANUAL_TEST_ACTOR_ID } from "@/lib/purse/constants";

function parseArgs(argv: string[]): {
  to: string | null;
  operationId: string | null;
} {
  let to: string | null = null;
  let operationId: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--to" || arg === "--recipient") {
      to = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--operation-id" || arg === "--op") {
      operationId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
  }
  return { to, operationId };
}

async function main() {
  const { to, operationId } = parseArgs(process.argv.slice(2));
  if (!to || !operationId) {
    console.error(
      [
        "Usage:",
        "  npm run purse:transfer-one-test -- --to 0xRecipient --operation-id test:unique-op-id",
        "",
        "Amount is fixed to 1 disposable test token. Amount cannot be overridden.",
        "NOT OFFICIAL FENN. Requires FENN_PURSE_TEST_MODE=explicit_allow.",
        "Private key is never printed.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  let preview: Awaited<ReturnType<typeof buildManualTestTransferPreview>>;
  try {
    preview = await buildManualTestTransferPreview({
      recipientAddress: to,
      operationId,
    });
  } catch (error) {
    if (error instanceof PurseError) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            stage: "preview",
            code: error.code,
            message: error.message,
          },
          null,
          2,
        ),
      );
    } else {
      console.error(
        "[purse:transfer-one-test] preview failed",
        error instanceof Error ? error.message : error,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        stage: "preview",
        mode: preview.mode,
        purseAddress: preview.purseAddress,
        recipient: preview.recipient,
        amount: preview.amount,
        asset: preview.asset,
        tokenAddress: preview.tokenAddress,
        chainId: preview.chainId,
        chainName: preview.chainName,
        operationId: preview.operationId,
        warning: preview.warning,
        note: "Executing TEST transfer next — confirmation wait will begin on-chain.",
      },
      null,
      2,
    ),
  );

  const result = await executeManualTestTransfer({
    recipientAddress: to,
    operationId,
    actorId: P0_MANUAL_TEST_ACTOR_ID,
  });

  if (result.ok) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "TEST",
          status: result.status,
          operationId: result.operationId,
          transferId: result.transferId,
          purseAddress: result.purseAddress,
          recipient: result.recipientAddress,
          amount: result.amountFormatted,
          tokenAddress: result.tokenAddress,
          chainId: result.chainId,
          txHash: result.txHash,
          confirmedAt: result.confirmedAt,
          reusedExisting: result.reusedExisting,
          isTest: result.isTest,
          warning: "NOT OFFICIAL FENN",
        },
        null,
        2,
      ),
    );
    return;
  }

  console.error(
    JSON.stringify(
      {
        ok: false,
        mode: "TEST",
        code: result.code,
        message: result.message,
        operationId: result.operationId,
        status: result.status ?? null,
        txHash: result.txHash ?? null,
        failureClass: result.failureClass ?? null,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    "[purse:transfer-one-test] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
