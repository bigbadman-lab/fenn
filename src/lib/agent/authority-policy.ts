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
  stage12WallSourceExternalId,
  stage12WallWriteInput,
} from "@/lib/wall/stage12-tool-contract";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";
import { validateWriteFennWallEntryInput } from "@/lib/wall/write";

export type AuthorityJudgementInput = {
  perceptionEventId: string;
  judgementId: string;
  xPostId: string;
  perceptionType: string;
  finalStatus: string;
  finalAction: string | null;
  finalReplyText: string | null;
  finalWallBody: string | null;
  /**
   * Desk Wall test / explicit ops only.
   * When true, permits wall-only effects for the reserved synthetic path.
   * Live X pipeline must leave this unset/false — wall always requires a reply.
   */
  allowOperationalWallOnly?: boolean;
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

/**
 * Pure deterministic authority. No I/O. No model. No side effects.
 */
export function evaluateAuthorityDecision(
  input: AuthorityJudgementInput,
): AuthorityDecision {
  const sourceXPostId = input.xPostId.trim();
  const finalAction = (input.finalAction ?? "unknown").trim() || "unknown";

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
    };
  }

  if (input.finalStatus !== "finalized") {
    return deny(input, "invalid_final_judgement", finalAction);
  }

  if (!isStage12KnownAgentAction(finalAction)) {
    return deny(input, "invalid_final_judgement", "unknown");
  }

  if (finalAction === "do_nothing") {
    return {
      outcome: "no_action",
      policyCode: "no_action",
      policyVersion: STAGE125_POLICY_VERSION,
      finalAction,
      sourceXPostId,
      effects: [],
    };
  }

  if (finalAction === "reply_on_x") {
    const reply = validateReplyText(input.finalReplyText);
    if (!reply.ok) {
      return deny(input, reply.code, finalAction);
    }
    return {
      outcome: "permitted",
      policyCode: "permitted_reply",
      policyVersion: STAGE125_POLICY_VERSION,
      finalAction,
      sourceXPostId,
      effects: [
        {
          type: "reply_on_x",
          idempotencyKey: stage12ReplyIdempotencyKey(sourceXPostId),
          payload: {
            replyToXPostId: sourceXPostId,
            text: reply.text,
          },
        },
      ],
    };
  }

  // Live X: wall-only is forbidden. Desk ops may opt into wall-only via flag.
  if (finalAction === STAGE12_LEGACY_WALL_ONLY_ACTION) {
    if (!input.allowOperationalWallOnly) {
      return deny(input, "wall_requires_reply", finalAction);
    }
    const wall = validateWallBody(input.finalWallBody);
    if (!wall.ok) {
      return deny(input, wall.code, finalAction);
    }
    return {
      outcome: "permitted",
      policyCode: "permitted_wall",
      policyVersion: STAGE125_POLICY_VERSION,
      finalAction,
      sourceXPostId,
      // Reply is intentionally absent — isolated infrastructure test only.
      effects: [planWallEffect(sourceXPostId, wall.body)],
    };
  }

  // reply_and_write_to_wall — both must pass; no partial authorisation.
  // Effect order: reply first (conversation acknowledged), then Wall (memory).
  if (finalAction === "reply_and_write_to_wall") {
    const reply = validateReplyText(input.finalReplyText);
    const wall = validateWallBody(input.finalWallBody);
    if (!reply.ok && !wall.ok) {
      return deny(input, "invalid_candidate", finalAction);
    }
    if (!reply.ok) {
      return deny(input, reply.code, finalAction);
    }
    if (!wall.ok) {
      return deny(input, wall.code, finalAction);
    }

    return {
      outcome: "permitted",
      policyCode: "permitted_reply_and_wall",
      policyVersion: STAGE125_POLICY_VERSION,
      finalAction,
      sourceXPostId,
      effects: [
        {
          type: "reply_on_x",
          idempotencyKey: stage12ReplyIdempotencyKey(sourceXPostId),
          payload: {
            replyToXPostId: sourceXPostId,
            text: reply.text,
          },
        },
        planWallEffect(sourceXPostId, wall.body),
      ],
    };
  }

  return deny(input, "invalid_final_judgement", finalAction);
}
