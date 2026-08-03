/**
 * Trusted ops CLI: Desk Wall-only agent effect test.
 *
 * Usage:
 *   npm run agent:test-wall
 *
 * Same service helper as POST /api/desk/agent/wall-test.
 * Never posts to X. Idempotent for the server-controlled test version.
 */

import { runDeskAgentWallTest } from "@/lib/agent/desk-wall-test";

async function main() {
  const result = await runDeskAgentWallTest({
    actorId: "ops:agent-test-wall-cli",
  });

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        status: result.status,
        wallEntryId: result.wallEntryId ?? null,
        effectId: result.effectId ?? null,
        testVersion: result.testVersion,
        xAttempted: result.xAttempted,
        durationMs: result.durationMs,
        errorCode: result.errorCode ?? null,
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
    "[agent:test-wall] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
