/**
 * Deterministic visible-reply guarantee for Stage 12 X judgements.
 *
 * Model may still emit soft silence signals; after parse, eligible perceptions
 * are normalised so ordinary **final** outcomes are only:
 *   - reply_on_x              (policy label: reply_only)
 *   - reply_and_write_to_wall (policy label: wall_and_reply)
 *
 * Hard blocks remain do_nothing (policy label: blocked) with zero effects.
 *
 * Missing reply drafts on eligible outcomes leave action + null replyText for
 * the focused recovery writer — never silence / knowledge_unavailable for
 * missing text alone.
 *
 * Intermediate 12.3 intentions that request live state may still be silence
 * until Stage 12.4 re-judges with trusted reads.
 *
 * Schema preserves existing live action strings (no DB migration).
 */

import {
  STAGE12_JUDGEMENT_REASON_CODES,
  type Stage12JudgementReasonCode,
} from "@/lib/agent/judge-config";
import type { Stage125EffectType } from "@/lib/agent/authority-config";

/** Observability / Desk labels — not DB column values. */
export const STAGE12_POLICY_OUTCOMES = [
  "reply_only",
  "wall_and_reply",
  "blocked",
  "reply_failed",
  "wall_failed",
  "partially_completed",
  "reply_generation_failed",
  "reply_pending_retry",
  "reply_recovery_attempted",
  "reply_recovery_succeeded",
] as const;

export type Stage12PolicyOutcome = (typeof STAGE12_POLICY_OUTCOMES)[number];

/**
 * Hard blocks established before reply writing (zero effects, no recovery).
 * Missing replyText must never be treated as knowledge_unavailable.
 * Ordinary uncertainty is not a hard block — recovery produces a honest reply.
 */
export const STAGE12_HARD_BLOCK_REASON_CODES = [
  "spam_or_noise",
  "unsafe_or_injection",
] as const satisfies readonly Stage12JudgementReasonCode[];

export type Stage12HardBlockReasonCode =
  (typeof STAGE12_HARD_BLOCK_REASON_CODES)[number];

/** Judgement-time block taxonomy (machine-readable). */
export const STAGE12_JUDGEMENT_BLOCK_REASONS = [
  "spam",
  "unsafe",
  "inaccessible",
  "authority_unavailable",
  "duplicate",
  "self_authored",
  "rate_limited",
  "administratively_suppressed",
  "execution_failure",
] as const;

export type Stage12JudgementBlockReason =
  (typeof STAGE12_JUDGEMENT_BLOCK_REASONS)[number];

const HARD_BLOCK_SET = new Set<string>(STAGE12_HARD_BLOCK_REASON_CODES);

export function isHardBlockReasonCode(
  code: string | null | undefined,
): code is Stage12HardBlockReasonCode {
  return typeof code === "string" && HARD_BLOCK_SET.has(code);
}

export function isKnownJudgementReasonCode(
  code: string,
): code is Stage12JudgementReasonCode {
  return (STAGE12_JUDGEMENT_REASON_CODES as readonly string[]).includes(code);
}

/**
 * Map live action → policy outcome label.
 * do_nothing and unknown → blocked.
 */
export function policyOutcomeFromAction(
  action: string | null | undefined,
): Stage12PolicyOutcome {
  if (action === "reply_on_x") return "reply_only";
  if (action === "reply_and_write_to_wall") return "wall_and_reply";
  return "blocked";
}

/**
 * Map reason code → judgement-time block taxonomy when hard-blocked.
 */
export function judgementBlockReasonFromReasonCode(
  reasonCode: string | null | undefined,
): Stage12JudgementBlockReason | null {
  switch (reasonCode) {
    case "spam_or_noise":
      return "spam";
    case "unsafe_or_injection":
      return "unsafe";
    default:
      return null;
  }
}

export type ReplyGuaranteeAction =
  | "do_nothing"
  | "reply_on_x"
  | "reply_and_write_to_wall";

export type ReplyGuaranteeFields = {
  engage: boolean;
  action: ReplyGuaranteeAction;
  reasonCode: Stage12JudgementReasonCode;
  replyText: string | null;
  wallBody: string | null;
  /** True when eligible and reply draft is missing — recovery writer should run. */
  needsReplyRecovery: boolean;
};

/**
 * Enforce reply guarantee on a live intention after basic string sanitation.
 *
 * @param allowDeferredLiveSilence When true (Stage 12.3 with needsLiveState),
 *   soft silence may remain so Stage 12.4 can re-judge after live reads.
 *   Final judgement (12.4) must pass false.
 */
export function applyReplyGuaranteePolicy(input: {
  engage: boolean;
  action: string;
  reasonCode: string;
  replyText: string | null;
  wallBody: string | null;
  /** When true, treat as operational hard block regardless of model reason. */
  forceHardBlock?: boolean;
  forceHardBlockReason?: Stage12JudgementReasonCode;
  /**
   * Intermediate 12.3 silence pending live tools. Soft silence is kept only when
   * this is true AND reason is requires_live_state (or no draft yet with live pending).
   */
  allowDeferredLiveSilence?: boolean;
  /**
   * Self-knowledge / economic-boundary conversation with public knowledge available.
   * Model spam_or_noise mislabels are elevated to eligible reply/recovery —
   * unsafe_or_injection still hard-blocks.
   */
  promoteCapabilityConversationSpam?: boolean;
}): ReplyGuaranteeFields {
  const reply =
    input.replyText === null || input.replyText.trim().length === 0
      ? null
      : input.replyText;
  const wall =
    input.wallBody === null || input.wallBody.length === 0
      ? null
      : input.wallBody;

  // Never invent knowledge_unavailable for missing drafts.
  let reasonCode = isKnownJudgementReasonCode(input.reasonCode)
    ? input.reasonCode
    : "insufficient_knowledge";

  if (input.forceHardBlock) {
    // forceHardBlock is reserved for true safety blocks only (spam/unsafe).
    const forceReason = input.forceHardBlockReason ?? "unsafe_or_injection";
    if (isHardBlockReasonCode(forceReason)) {
      return hardBlock(forceReason);
    }
    // Non-hard force (e.g. legacy knowledge down) → eligible recovery path.
    reasonCode =
      forceReason === "knowledge_unavailable"
        ? "insufficient_knowledge"
        : forceReason;
  }

  if (isHardBlockReasonCode(reasonCode)) {
    if (
      reasonCode === "spam_or_noise" &&
      input.promoteCapabilityConversationSpam
    ) {
      // Knowledge-backed capability conversation must not hard-silence.
      reasonCode = "answered_from_public_knowledge";
    } else {
      return hardBlock(reasonCode);
    }
  }

  // Prefer dual when both drafts exist (wall must never replace the reply).
  if (reply && wall) {
    return {
      engage: true,
      action: "reply_and_write_to_wall",
      reasonCode: dualReason(reasonCode),
      replyText: reply,
      wallBody: wall,
      needsReplyRecovery: false,
    };
  }

  // Explicit dual or reply with reply only (draft present).
  if (reply && !wall) {
    return {
      engage: true,
      action: "reply_on_x",
      reasonCode: softToGrounded(reasonCode),
      replyText: reply,
      wallBody: null,
      needsReplyRecovery: false,
    };
  }

  // Wall draft without reply: keep dual intention; recovery must write the reply.
  // Never wall-only and never label missing text as knowledge_unavailable.
  if (wall && !reply) {
    return {
      engage: true,
      action: "reply_and_write_to_wall",
      reasonCode: dualReason(reasonCode),
      replyText: null,
      wallBody: wall,
      needsReplyRecovery: true,
    };
  }

  // Deferred live-state: 12.3 may silence until tools run (no recovery yet).
  if (
    input.allowDeferredLiveSilence &&
    (reasonCode === "requires_live_state" ||
      input.action === "do_nothing" ||
      !input.engage)
  ) {
    return {
      engage: false,
      action: "do_nothing",
      reasonCode:
        reasonCode === "requires_live_state"
          ? "requires_live_state"
          : reasonCode,
      replyText: null,
      wallBody: null,
      needsReplyRecovery: false,
    };
  }

  // Soft silence / empty / ignore / no ordinary action with no draft:
  // Eligible reply_only pending recovery — never silent completion.
  return {
    engage: true,
    action: "reply_on_x",
    reasonCode: softToGrounded(reasonCode),
    replyText: null,
    wallBody: null,
    needsReplyRecovery: true,
  };
}

function dualReason(
  reasonCode: Stage12JudgementReasonCode,
): Stage12JudgementReasonCode {
  if (
    reasonCode === "answered_from_public_knowledge" ||
    reasonCode === "no_response_warranted" ||
    reasonCode === "low_relevance" ||
    reasonCode === "knowledge_unavailable"
  ) {
    return "creative_world_action";
  }
  return reasonCode;
}

function softToGrounded(
  reasonCode: Stage12JudgementReasonCode,
): Stage12JudgementReasonCode {
  // Missing draft must never become knowledge_unavailable.
  if (reasonCode === "knowledge_unavailable") {
    return "insufficient_knowledge";
  }
  if (
    reasonCode === "no_response_warranted" ||
    reasonCode === "low_relevance"
  ) {
    return "answered_from_public_knowledge";
  }
  return reasonCode;
}

function hardBlock(
  reasonCode: Stage12JudgementReasonCode,
): ReplyGuaranteeFields {
  return {
    engage: false,
    action: "do_nothing",
    reasonCode,
    replyText: null,
    wallBody: null,
    needsReplyRecovery: false,
  };
}

/**
 * Planned-effect invariant for authorisations.
 * Speech path: exactly 1 reply_on_x, 0–1 write_to_wall.
 * Economic-only path: 0 speech + 1 transfer_fenn or burn_fenn (P1B).
 * Combined path: speech rules + 0–1 economic effect.
 */
export function assertEligibleEffectsInvariant(
  effects: ReadonlyArray<{ type: Stage125EffectType | string }>,
): {
  ok: boolean;
  replyCount: number;
  wallCount: number;
  violation: string | null;
} {
  let replyCount = 0;
  let wallCount = 0;
  let transferCount = 0;
  let burnCount = 0;
  for (const e of effects) {
    if (e.type === "reply_on_x") replyCount += 1;
    else if (e.type === "write_to_wall") wallCount += 1;
    else if (e.type === "transfer_fenn") transferCount += 1;
    else if (e.type === "burn_fenn") burnCount += 1;
  }

  const economicCount = transferCount + burnCount;
  if (economicCount > 1) {
    return {
      ok: false,
      replyCount,
      wallCount,
      violation: `expected at most 1 economic effect, got ${economicCount}`,
    };
  }
  if (transferCount > 0 && burnCount > 0) {
    return {
      ok: false,
      replyCount,
      wallCount,
      violation: "cannot plan transfer and burn together",
    };
  }

  // Economic-only (rare): allowed without X reply.
  if (replyCount === 0 && wallCount === 0 && economicCount === 1) {
    return { ok: true, replyCount, wallCount, violation: null };
  }

  if (replyCount !== 1) {
    return {
      ok: false,
      replyCount,
      wallCount,
      violation: `expected exactly 1 reply_on_x effect, got ${replyCount}`,
    };
  }
  if (wallCount > 1) {
    return {
      ok: false,
      replyCount,
      wallCount,
      violation: `expected at most 1 write_to_wall effect, got ${wallCount}`,
    };
  }
  if (wallCount > replyCount) {
    return {
      ok: false,
      replyCount,
      wallCount,
      violation: "wall count must never exceed reply count",
    };
  }
  return { ok: true, replyCount, wallCount, violation: null };
}

/**
 * Summarise completed execution of planned effects into a policy outcome label.
 */
export function policyOutcomeFromEffectExecution(input: {
  planned: ReadonlyArray<{ type: string }>;
  completed: ReadonlyArray<{ type: string; status: string }>;
}): Stage12PolicyOutcome {
  const plannedReply = input.planned.filter((e) => e.type === "reply_on_x")
    .length;
  const plannedWall = input.planned.filter((e) => e.type === "write_to_wall")
    .length;

  if (plannedReply === 0 && plannedWall === 0) {
    return "blocked";
  }

  const replyDone = input.completed.some(
    (e) => e.type === "reply_on_x" && e.status === "completed",
  );
  const replyFailed = input.completed.some(
    (e) => e.type === "reply_on_x" && e.status === "failed",
  );
  const wallDone = input.completed.some(
    (e) => e.type === "write_to_wall" && e.status === "completed",
  );
  const wallFailed = input.completed.some(
    (e) => e.type === "write_to_wall" && e.status === "failed",
  );

  if (plannedWall > 0) {
    if (replyDone && wallDone) return "wall_and_reply";
    if (replyDone && wallFailed) return "wall_failed";
    if (replyFailed && wallDone) return "reply_failed";
    if (replyFailed && wallFailed) return "partially_completed";
    if (replyDone && !wallDone && !wallFailed) return "partially_completed";
    if (!replyDone && wallDone) return "reply_failed";
    if (replyFailed) return "reply_failed";
    if (wallFailed) return "wall_failed";
    return "partially_completed";
  }

  if (replyDone) return "reply_only";
  if (replyFailed) return "reply_failed";
  return "partially_completed";
}

/** Wall reply language — narrow instruction when dual is selected. */
export function wallAndReplyLanguageInstruction(): string {
  return [
    "WALL + REPLY language (when action is reply_and_write_to_wall):",
    "- In replyText, acknowledge naturally that the words were preserved, kept, marked, written, or carried into the Wall.",
    "- Vary wording; do not always use the same phrase.",
    "- Avoid technical terms: database, record, effect, ingestion, stored, API, tool.",
    "- Still answer the person; never only point at the Wall.",
    "- Keep THE BOOK OF SPEECH voice.",
  ].join("\n");
}
