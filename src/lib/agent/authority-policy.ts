import {
  isStage12KnownAgentAction,
  STAGE12_LEGACY_WALL_ONLY_ACTION,
} from "@/lib/agent/actions";
import {
  STAGE125_POLICY_VERSION,
  stage12ReplyIdempotencyKey,
  type Stage125AuthorityOutcome,
  type Stage125EffectType,
  type Stage125PolicyCode,
} from "@/lib/agent/authority-config";
import { STAGE12_X_REPLY_MAX_CHARS } from "@/lib/agent/judge-config";
import {
  applyReplyGuaranteePolicy,
  assertEligibleEffectsInvariant,
  isHardBlockReasonCode,
  policyOutcomeFromAction,
  type Stage12PolicyOutcome,
} from "@/lib/agent/reply-guarantee-policy";
import {
  stage12WallSourceExternalId,
  stage12WallWriteInput,
} from "@/lib/wall/stage12-tool-contract";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";
import { validateWriteFennWallEntryInput } from "@/lib/wall/write";
import { planEconomicEffects } from "@/lib/agent/economic-authority";
import { economicIntentFromJson } from "@/lib/agent/economic-intent";

export type AuthorityJudgementInput = {
  perceptionEventId: string;
  judgementId: string;
  xPostId: string;
  perceptionType: string;
  finalStatus: string;
  finalAction: string | null;
  finalReplyText: string | null;
  finalWallBody: string | null;
  /** Final reason — used for hard-block vs soft soft-silence elevation. */
  finalReasonCode?: string | null;
  /**
   * Desk Wall test / explicit ops only.
   * When true, permits wall-only effects for the reserved synthetic path.
   * Live X pipeline must leave this unset/false — wall always requires a reply.
   */
  allowOperationalWallOnly?: boolean;
  /**
   * Stage P1B economic intention from final judge (persisted jsonb).
   * Model proposal only — amounts/recipients never trusted from here alone.
   */
  finalEconomicIntent?: unknown | null;
  /**
   * Trusted context for planning economic effects. Absent → no economic plan.
   */
  economicContext?: {
    harnessBoundWallet?: string | null;
    executionRail: "official" | "p1a_test";
    purseState: import("@/lib/agent/purse-economic-context").PurseEconomicState | null;
    sufficientBalance?: boolean;
  } | null;
};

export type AuthorityEffectPlan = {
  type: Stage125EffectType;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

export type AuthorityDecision = {
  outcome: Stage125AuthorityOutcome;
  policyCode: Stage125PolicyCode;
  policyVersion: typeof STAGE125_POLICY_VERSION;
  finalAction: string;
  sourceXPostId: string;
  effects: AuthorityEffectPlan[];
  /** Observability label (not persisted unless callers log it). */
  policyOutcome: Stage12PolicyOutcome;
};

function isDigitSnowflake(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function hasNulOrDangerousControls(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    // Allow TAB (9), LF (10), CR (13). Reject other C0 controls + DEL.
    if (code === 127) return true;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

function validateReplyText(text: string | null): {
  ok: true;
  text: string;
} | {
  ok: false;
  code: Stage125PolicyCode;
} {
  if (text == null || text.trim().length === 0) {
    return { ok: false, code: "missing_reply_candidate" };
  }
  if (text.length > STAGE12_X_REPLY_MAX_CHARS) {
    return { ok: false, code: "invalid_candidate" };
  }
  if (hasNulOrDangerousControls(text)) {
    return { ok: false, code: "invalid_candidate" };
  }
  return { ok: true, text };
}

function validateWallBody(body: string | null): {
  ok: true;
  body: string;
} | {
  ok: false;
  code: Stage125PolicyCode;
} {
  if (body == null || body.length === 0 || body.trim().length === 0) {
    return { ok: false, code: "missing_wall_candidate" };
  }
  if (body.length > WALL_BODY_MAX_CHARS) {
    return { ok: false, code: "invalid_candidate" };
  }
  if (hasNulOrDangerousControls(body)) {
    return { ok: false, code: "invalid_candidate" };
  }

  // Defence-in-depth via existing Wall validator; provenance is application-owned.
  try {
    validateWriteFennWallEntryInput({
      body,
      sourceType: "x_agent",
      sourceExternalId: "0:wall",
    });
  } catch {
    return { ok: false, code: "invalid_candidate" };
  }

  return { ok: true, body };
}

function deny(
  input: AuthorityJudgementInput,
  policyCode: Stage125PolicyCode,
  finalAction: string,
): AuthorityDecision {
  return {
    outcome: "denied",
    policyCode,
    policyVersion: STAGE125_POLICY_VERSION,
    finalAction,
    sourceXPostId: input.xPostId.trim(),
    effects: [],
    policyOutcome: "blocked",
  };
}

function planReplyEffect(
  sourceXPostId: string,
  text: string,
): AuthorityEffectPlan {
  return {
    type: "reply_on_x",
    idempotencyKey: stage12ReplyIdempotencyKey(sourceXPostId),
    payload: {
      replyToXPostId: sourceXPostId,
      text,
    },
  };
}

function planWallEffect(
  sourceXPostId: string,
  body: string,
): AuthorityEffectPlan {
  const sourceExternalId = stage12WallSourceExternalId(sourceXPostId);
  const locked = stage12WallWriteInput({
    body,
    sourceExternalId,
  });
  return {
    type: "write_to_wall",
    idempotencyKey: sourceExternalId,
    payload: {
      body: locked.body,
      sourceType: locked.sourceType,
      sourceExternalId: locked.sourceExternalId,
    },
  };
}

function permitted(
  input: AuthorityJudgementInput,
  policyCode: Stage125PolicyCode,
  finalAction: string,
  effects: AuthorityEffectPlan[],
): AuthorityDecision {
  const invariant = assertEligibleEffectsInvariant(effects);
  if (!invariant.ok) {
    // Never persist a permitted decision that violates the visible-reply guarantee.
    return deny(input, "invalid_final_judgement", finalAction);
  }
  return {
    outcome: "permitted",
    policyCode,
    policyVersion: STAGE125_POLICY_VERSION,
    finalAction,
    sourceXPostId: input.xPostId.trim(),
    effects,
    policyOutcome: policyOutcomeFromAction(finalAction),
  };
}

function appendEconomicEffects(
  input: AuthorityJudgementInput,
  base: AuthorityDecision,
): AuthorityDecision {
  if (base.outcome === "denied") return base;

  const economicIntent = economicIntentFromJson(
    input.finalEconomicIntent ?? { type: "NONE" },
  );
  if (economicIntent.type === "NONE") return base;
  if (!input.economicContext) return base;

  const planned = planEconomicEffects({
    economicIntent,
    reasonCode: input.finalReasonCode,
    perceptionEventId: input.perceptionEventId,
    harnessBoundWallet: input.economicContext.harnessBoundWallet,
    purseState: input.economicContext.purseState,
    executionRail: input.economicContext.executionRail,
    sufficientBalance: input.economicContext.sufficientBalance,
  });

  if (planned.effects.length === 0) return base;

  const effects = [...base.effects, ...planned.effects];
  const hasSpeech = effects.some(
    (e) => e.type === "reply_on_x" || e.type === "write_to_wall",
  );
  const policyCode: Stage125PolicyCode =
    hasSpeech && planned.policyHint
      ? "permitted_reply_and_economic"
      : planned.policyHint ?? base.policyCode;

  // Economic-only permitted when speech outcome was no_action.
  if (base.outcome === "no_action" && !hasSpeech) {
    const invariant = assertEligibleEffectsInvariant(effects);
    if (!invariant.ok) {
      return base;
    }
    return {
      outcome: "permitted",
      policyCode,
      policyVersion: STAGE125_POLICY_VERSION,
      finalAction: base.finalAction,
      sourceXPostId: base.sourceXPostId,
      effects,
      policyOutcome: base.policyOutcome,
    };
  }

  if (base.outcome !== "permitted") return base;

  const invariant = assertEligibleEffectsInvariant(effects);
  if (!invariant.ok) {
    return base;
  }

  return {
    ...base,
    policyCode,
    effects,
  };
}

/**
 * Pure deterministic authority. No I/O. No model. No side effects.
 *
 * Second-layer reply guarantee: soft silence with drafts elevates; wall never
 * without reply; eligible permitted outcomes always plan exactly one X reply.
 */
export function evaluateAuthorityDecision(
  input: AuthorityJudgementInput,
): AuthorityDecision {
  const sourceXPostId = input.xPostId.trim();
  let finalAction = (input.finalAction ?? "unknown").trim() || "unknown";
  let replyText = input.finalReplyText;
  let wallBody = input.finalWallBody;
  const reasonCode = (input.finalReasonCode ?? "").trim();

  if (!sourceXPostId || !isDigitSnowflake(sourceXPostId)) {
    return deny(input, "event_not_eligible", finalAction);
  }

  // Reactive-only MVP: only mention/reply perceptions from Stage 12.2.
  const perceptionType = input.perceptionType.trim();
  if (perceptionType !== "mention" && perceptionType !== "reply") {
    return deny(input, "event_not_eligible", finalAction);
  }

  if (input.finalStatus === "failed") {
    return {
      outcome: "denied",
      policyCode: "judgement_failed",
      policyVersion: STAGE125_POLICY_VERSION,
      finalAction,
      sourceXPostId,
      effects: [],
      policyOutcome: "blocked",
    };
  }

  if (input.finalStatus !== "finalized") {
    return deny(input, "invalid_final_judgement", finalAction);
  }

  // Legacy wall-only with Desk ops flag — isolated infrastructure test.
  if (finalAction === STAGE12_LEGACY_WALL_ONLY_ACTION) {
    if (input.allowOperationalWallOnly) {
      const wall = validateWallBody(wallBody);
      if (!wall.ok) {
        return deny(input, wall.code, finalAction);
      }
      return {
        outcome: "permitted",
        policyCode: "permitted_wall",
        policyVersion: STAGE125_POLICY_VERSION,
        finalAction,
        sourceXPostId,
        // Reply intentionally absent — isolated infrastructure test only.
        effects: [planWallEffect(sourceXPostId, wall.body)],
        policyOutcome: "blocked",
      };
    }
    // Live: wall-only with a reply draft → elevate to dual; wall-only alone denied.
    if (replyText && wallBody) {
      finalAction = "reply_and_write_to_wall";
    } else {
      return deny(input, "wall_requires_reply", finalAction);
    }
  }

  // Second-layer normalisation (eligible → reply_only / wall_and_reply).
  // Keep hard-block do_nothing; elevate soft silence; missing draft stays eligible for recovery.
  if (
    isStage12KnownAgentAction(finalAction) ||
    finalAction === "do_nothing" ||
    finalAction === "unknown"
  ) {
    const guaranteed = applyReplyGuaranteePolicy({
      engage:
        finalAction !== "do_nothing" &&
        finalAction !== "unknown" &&
        !isHardBlockReasonCode(reasonCode),
      action: finalAction === "unknown" ? "do_nothing" : finalAction,
      reasonCode: reasonCode || "insufficient_knowledge",
      replyText,
      wallBody,
      allowDeferredLiveSilence: false,
    });
    finalAction = guaranteed.action;
    replyText = guaranteed.replyText;
    wallBody = guaranteed.wallBody;
  }

  if (!isStage12KnownAgentAction(finalAction)) {
    return deny(input, "invalid_final_judgement", "unknown");
  }

  if (finalAction === "do_nothing") {
    return appendEconomicEffects(input, {
      outcome: "no_action",
      policyCode: "no_action",
      policyVersion: STAGE125_POLICY_VERSION,
      finalAction,
      sourceXPostId,
      effects: [],
      policyOutcome: "blocked",
    });
  }

  if (finalAction === "reply_on_x") {
    const reply = validateReplyText(replyText);
    if (!reply.ok) {
      return {
        outcome: "denied",
        policyCode: reply.code,
        policyVersion: STAGE125_POLICY_VERSION,
        finalAction,
        sourceXPostId,
        effects: [],
        policyOutcome: "reply_generation_failed",
      };
    }
    return appendEconomicEffects(
      input,
      permitted(input, "permitted_reply", finalAction, [
        planReplyEffect(sourceXPostId, reply.text),
      ]),
    );
  }

  // reply_and_write_to_wall — both must pass; always plan reply + wall.
  if (finalAction === "reply_and_write_to_wall") {
    const reply = validateReplyText(replyText);
    const wall = validateWallBody(wallBody);
    if (!reply.ok) {
      return {
        outcome: "denied",
        policyCode: reply.code,
        policyVersion: STAGE125_POLICY_VERSION,
        finalAction,
        sourceXPostId,
        effects: [],
        // Never plan wall without reply. Operational — recovery / retry upstream.
        policyOutcome: "reply_generation_failed",
      };
    }
    if (!wall.ok) {
      // Dual missing wall → reply-only elevation (wall never without reply).
      return appendEconomicEffects(
        input,
        permitted(input, "permitted_reply", "reply_on_x", [
          planReplyEffect(sourceXPostId, reply.text),
        ]),
      );
    }

    return appendEconomicEffects(
      input,
      permitted(input, "permitted_reply_and_wall", finalAction, [
        planReplyEffect(sourceXPostId, reply.text),
        planWallEffect(sourceXPostId, wall.body),
      ]),
    );
  }

  return deny(input, "invalid_final_judgement", finalAction);
}
