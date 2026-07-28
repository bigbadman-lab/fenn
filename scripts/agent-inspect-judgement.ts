/**
 * Trusted ops: inspect one persisted X judgement + authority + effects.
 *
 * Usage:
 *   npm run agent:inspect-judgement -- --x-post-id=123
 *
 * Safe fields only — no retrieval scores / chain-of-thought / OAuth secrets.
 */

import { inspectAuthorizationByXPostId } from "@/lib/agent/authority-persist";
import { inspectJudgementByXPostId } from "@/lib/agent/judge-persist";

function parseXPostId(argv: string[]): string | null {
  const flag = argv.find((a) => a.startsWith("--x-post-id="));
  if (!flag) return null;
  const value = flag.slice("--x-post-id=".length).trim();
  return value.length > 0 ? value : null;
}

async function main() {
  const xPostId = parseXPostId(process.argv.slice(2));
  if (!xPostId) {
    console.error("Usage: npm run agent:inspect-judgement -- --x-post-id=<id>");
    process.exitCode = 1;
    return;
  }

  const view = await inspectJudgementByXPostId(xPostId);
  if (!view) {
    console.log(`No judgement for x_post_id=${xPostId}`);
    process.exitCode = 1;
    return;
  }

  const lines = [
    "X judgement inspection",
    `x_post_id: ${view.xPostId}`,
    `perception_status: ${view.perceptionStatus}`,
    `action: ${view.action}`,
    `reasonCode: ${view.reasonCode}`,
    `engage: ${view.engage}`,
    `identityUnverified: ${view.identityUnverified}`,
    `needsLiveState: ${view.needsLiveState.join(",") || "(none)"}`,
    `knowledgeAvailable: ${view.knowledgeAvailable}`,
    `model: ${view.model}`,
    `promptVersion: ${view.promptVersion}`,
    `replyText: ${view.replyText === null ? "(none)" : JSON.stringify(view.replyText)}`,
    `wallBody: ${view.wallBody === null ? "(none)" : JSON.stringify(view.wallBody)}`,
    `final_status: ${view.finalStatus}`,
    `final_action: ${view.finalAction ?? "(none)"}`,
    `final_reasonCode: ${view.finalReasonCode ?? "(none)"}`,
    `final_engage: ${view.finalEngage}`,
    `final_replyText: ${view.finalReplyText === null ? "(none)" : JSON.stringify(view.finalReplyText)}`,
    `final_wallBody: ${view.finalWallBody === null ? "(none)" : JSON.stringify(view.finalWallBody)}`,
    `live_state_available: ${view.liveStateAvailable}`,
    `live_state_succeeded: ${view.liveStateSucceeded.join(",") || "(none)"}`,
    `live_state_failed: ${view.liveStateFailed.join(",") || "(none)"}`,
    `excerpt: ${JSON.stringify(view.perceptionExcerpt)}`,
  ];

  const auth = await inspectAuthorizationByXPostId(xPostId);
  if (!auth) {
    lines.push("authority: (none)");
  } else {
    lines.push(
      `authority_outcome: ${auth.outcome}`,
      `authority_policyCode: ${auth.policyCode}`,
      `authority_policyVersion: ${auth.policyVersion}`,
      `authority_finalAction: ${auth.finalAction}`,
      `authority_sourceXPostId: ${auth.sourceXPostId}`,
      `effects: ${auth.effects.length}`,
    );
    for (const e of auth.effects) {
      lines.push(
        [
          `- effect ${e.effectType}`,
          `status=${e.status}`,
          `attempts=${e.attemptCount}`,
          `key=${e.idempotencyKey}`,
          e.externalResultId ? `result=${e.externalResultId}` : null,
          e.failureClass ? `class=${e.failureClass}` : null,
          e.lastError ? `error=${e.lastError}` : null,
          e.completedAt ? `completed_at=${e.completedAt}` : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
    }
  }

  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(
    "[agent:inspect-judgement] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
