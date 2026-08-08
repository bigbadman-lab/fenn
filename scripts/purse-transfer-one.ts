/**
 * Operator CLI: transfer exactly 1 official FENN from THE PURSE.
 *
 * NEVER a public endpoint. NO autonomous agent behaviour.
 *
 * Usage:
 *   npm run purse:transfer-one -- --to 0xRecipient... --operation-id p0-test-001
 *
 * Safe preview is always printed first. Private key is never logged.
 */

import {
  buildManualTransferPreview,
  executeManualOneFennTransfer,
} from "@/lib/purse/transfer";
import { PurseError } from "@/lib/purse/errors";

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
        "  npm run purse:transfer-one -- --to 0xRecipient --operation-id unique-op-id",
        "",
        "Amount is fixed to 1 official FENN. Amount cannot be overridden.",
        "Private key is never printed.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  let preview: Awaited<ReturnType<typeof buildManualTransferPreview>>;
  try {
    preview = await buildManualTransferPreview({
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
        "[purse:transfer-one] preview failed",
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
        purseAddress: preview.purseAddress,
        recipient: preview.recipient,
        amount: preview.amount,
        asset: preview.asset,
        tokenAddress: preview.tokenAddress,
        chainId: preview.chainId,
        chainName: preview.chainName,
        operationId: preview.operationId,
        note: "Executing transfer next — confirmation wait will begin on-chain.",
      },
      null,
      2,
    ),
  );

  const result = await executeManualOneFennTransfer({
    recipientAddress: to,
    operationId,
    actorId: "ops:purse-transfer-one-cli",
  });

  if (result.ok) {
    console.log(
      JSON.stringify(
        {
          ok: true,
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
    "[purse:transfer-one] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
