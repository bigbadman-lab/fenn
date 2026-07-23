/**
 * Trusted ops: synchronise repository Canon into fenn_memories(layer=canon).
 *
 * Usage (from repo root, with local .env):
 *   npm run canon:sync
 *
 * Never call from page loads, browsers, or public routes.
 */

import { syncFennCanon } from "@/lib/canon/sync";

async function main() {
  const result = await syncFennCanon();
  console.log("[canon:sync] ok", result);
}

main().catch((error) => {
  console.error("[canon:sync] failed", error);
  process.exitCode = 1;
});
