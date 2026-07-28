import { STAGE12_AGENT_ACTIONS } from "@/lib/agent/actions";
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

  if (
    !STAGE12_AGENT_ACTIONS.includes(
      finalAction as (typeof STAGE12_AGENT_ACTIONS)[number],
    )
  ) {
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

  if (finalAction === "write_to_wall") {
    const wall = validateWallBody(input.finalWallBody);
    if (!wall.ok) {
      return deny(input, wall.code, finalAction);
    }
    const sourceExternalId = stage12WallSourceExternalId(sourceXPostId);
    // Lock provenance via existing Stage 12 Wall contract (never model-controlled).
    const locked = stage12WallWriteInput({
      body: wall.body,
      sourceExternalId,
    });
    return {
      outcome: "permitted",
      policyCode: "permitted_wall",
      policyVersion: STAGE125_POLICY_VERSION,
      finalAction,
      sourceXPostId,
      effects: [
        {
          type: "write_to_wall",
          idempotencyKey: sourceExternalId,
          payload: {
            body: locked.body,
            sourceType: locked.sourceType,
            sourceExternalId: locked.sourceExternalId,
          },
        },
      ],
    };
  }

  // reply_and_write_to_wall — both must pass; no partial authorisation.
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

    const sourceExternalId = stage12WallSourceExternalId(sourceXPostId);
    const locked = stage12WallWriteInput({
      body: wall.body,
      sourceExternalId,
    });

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
        {
          type: "write_to_wall",
          idempotencyKey: sourceExternalId,
          payload: {
            body: locked.body,
            sourceType: locked.sourceType,
            sourceExternalId: locked.sourceExternalId,
          },
        },
      ],
    };
  }

  return deny(input, "invalid_final_judgement", finalAction);
}
