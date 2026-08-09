/**
 * Operator CLI: knowledge-only FENN self-knowledge calibration.
 *
 * Usage:
 *   npm run agent:test-self-knowledge -- --text "What can you do?"
 *
 * Never posts to X, executes effects, calls Purse, or mutates memory/canon.
 */

import { runSelfKnowledgeCalibration } from "@/lib/agent/self-knowledge-calibration";

function parseArgs(argv: string[]): {
  text: string | null;
  limit: number | null;
  json: boolean;
  showRetrieval: boolean;
} {
  let text: string | null = null;
  let limit: number | null = null;
  let json = true; // default structured JSON
  let showRetrieval = true;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--text") {
      text = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--limit") {
      const n = Number.parseInt(argv[i + 1] ?? "", 10);
      if (Number.isFinite(n)) limit = n;
      i += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--no-json") {
      json = false;
      continue;
    }
    if (arg === "--show-retrieval") {
      showRetrieval = true;
      continue;
    }
    if (arg === "--hide-retrieval") {
      showRetrieval = false;
      continue;
    }
  }
  return { text, limit, json, showRetrieval };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.text?.trim()) {
    console.error(
      [
        "Usage: npm run agent:test-self-knowledge -- --text \"What can you do?\"",
        "",
        "Optional: --limit <n>  --hide-retrieval  --no-json",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const result = await runSelfKnowledgeCalibration({
    text: args.text,
    limit: args.limit ?? undefined,
  });

  if (args.json) {
    const payload = { ...result };
    if (!args.showRetrieval) {
      // Keep hits list empty in print only for compact runs; still true path.
      payload.retrieval = result.retrieval.map((r) => ({
        title: r.title,
        layer: r.layer,
        visibility: r.visibility,
        score: r.score,
        textPreview: "(hidden — omit --hide-retrieval to show)",
        memoryId: r.memoryId,
        chunkIndex: r.chunkIndex,
      }));
    }
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`mode: ${result.mode}`);
    console.log(`ok: ${result.ok}`);
    console.log(`question: ${result.question}`);
    console.log(`knowledgeAvailable: ${result.knowledgeAvailable}`);
    console.log(
      `retrievedAgencyCapabilities: ${result.retrievedAgencyCapabilities}`,
    );
    console.log(
      `retrievedEconomyCirculation: ${result.retrievedEconomyCirculation}`,
    );
    if (args.showRetrieval) {
      console.log("retrieval:");
      for (const row of result.retrieval) {
        console.log(
          `  - [${row.layer}/${row.visibility}] ${row.title} score=${row.score.toFixed(4)}`,
        );
        console.log(`    ${row.textPreview}`);
      }
    }
    console.log(`speechAction: ${result.speechAction}`);
    console.log(`replyText: ${result.replyText}`);
    console.log(`errorCode: ${result.errorCode}`);
    console.log(`durationMs: ${result.durationMs}`);
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[agent:test-self-knowledge] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
