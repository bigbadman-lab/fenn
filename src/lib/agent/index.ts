/**
 * Stage 11.7 public-agent boundary — Stage 12 facing surface.
 * Server-only helpers; Stage 12.3 adds judgement (no action execution).
 */

export * from "@/lib/agent/stage12-contract";
export * from "@/lib/agent/config";
export * from "@/lib/agent/judge-config";
export * from "@/lib/agent/judge-schema";
export {
  STAGE12_POLICY_OUTCOMES,
  STAGE12_HARD_BLOCK_REASON_CODES,
  applyReplyGuaranteePolicy,
  assertEligibleEffectsInvariant,
  policyOutcomeFromAction,
  isHardBlockReasonCode,
} from "@/lib/agent/reply-guarantee-policy";
export {
  STAGE12_REPLY_RECOVERY_PROMPT_VERSION,
  sanitizeReplyCandidate,
} from "@/lib/agent/reply-recovery-schema";
export {
  intentionNeedsReplyRecovery,
  ensureReplyTextWithRecovery,
  runFennReplyRecovery,
} from "@/lib/agent/reply-recovery";
export {
  buildFennPublicJudgeSystemPrompt,
  buildFennPublicJudgeUserPayload,
  FENN_UNTRUSTED_X_MARKERS,
} from "@/lib/agent/judge-prompt";
export {
  judgeOneXPerception,
  judgePendingXPerceptions,
  judgePerceptionContent,
  formatJudgeBatchReport,
} from "@/lib/agent/judge";
export {
  inspectJudgementByXPostId,
  claimXPerceptionForJudgement,
  finalizeXPerceptionJudgement,
  failXPerceptionJudgement,
} from "@/lib/agent/judge-persist";
export { AgentJudgeError } from "@/lib/agent/judge-errors";
