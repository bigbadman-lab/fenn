import { z } from "zod";

import { STAGE12_LIVE_AGENT_ACTIONS } from "@/lib/agent/actions";
import {
  STAGE12_JUDGEMENT_REASON_CODES,
  STAGE12_X_REPLY_MAX_CHARS,
} from "@/lib/agent/judge-config";
import { FENN_LIVE_CAPABILITIES } from "@/lib/agent/live-state";
import { applyReplyGuaranteePolicy } from "@/lib/agent/reply-guarantee-policy";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";

/**
 * Structured judgement the model may emit (live action set only).
 * Application owns provenance, execution, and authority fields.
 */
export const stage12JudgementModelSchema = z.object({
  /** Attention: does this event warrant any engagement? */
  engage: z.boolean(),
  action: z.enum(STAGE12_LIVE_AGENT_ACTIONS),
  reasonCode: z.enum(STAGE12_JUDGEMENT_REASON_CODES),
  replyText: z.string().max(STAGE12_X_REPLY_MAX_CHARS).nullable(),
  /** Wall candidate — do not trim internal whitespace. */
  wallBody: z.string().max(WALL_BODY_MAX_CHARS).nullable(),
  needsLiveState: z.array(z.enum(FENN_LIVE_CAPABILITIES)).max(7),
  identityUnverified: z.boolean(),
});

export type Stage12JudgementModelOutput = z.infer<
  typeof stage12JudgementModelSchema
>;

export type Stage12JudgementIntention = Stage12JudgementModelOutput & {
  knowledgeAvailable: boolean;
  model: string;
  promptVersion: string;
};

const FORBIDDEN_AUTHORITY_FIELDS = [
  "sourceType",
  "source_type",
  "sourceExternalId",
  "source_external_id",
  "createdAt",
  "created_at",
  "id",
  "eventId",
  "event_id",
  "perceptionEventId",
  "perception_event_id",
  "profileId",
  "profile_id",
  "author",
  "visibility",
  "markCount",
  "authority",
  "scope",
  "toolCredentials",
  "apiKey",
  "bearerToken",
] as const;

export function assertJudgementHasNoAuthorityFields(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const obj = value as Record<string, unknown>;
  for (const key of FORBIDDEN_AUTHORITY_FIELDS) {
    if (key in obj) {
      throw new Error(`Forbidden judgement field: ${key}`);
    }
  }
}

export function parseJudgementModelOutput(
  value: unknown,
): Stage12JudgementModelOutput {
  assertJudgementHasNoAuthorityFields(value);
  return stage12JudgementModelSchema.parse(value);
}

/**
 * Enforce action/content consistency and the visible-reply guarantee.
 * Never produces live wall-only intentions.
 * Does not invent reply text. Does not execute.
 */
export function normalizeJudgementIntention(input: {
  raw: Stage12JudgementModelOutput;
  knowledgeAvailable: boolean;
  model: string;
  promptVersion: string;
}): Stage12JudgementIntention {
  const { identityUnverified } = input.raw;
  // Deduplicate live-state requests; only allow known capabilities (schema already).
  const live = [...new Set(input.raw.needsLiveState)];
  const allowDeferredLiveSilence = live.length > 0;

  // Empty strings → null (wall keeps intentional internal whitespace).
  const replyText =
    input.raw.replyText === null || input.raw.replyText.trim().length === 0
      ? null
      : input.raw.replyText;
  const wallBody =
    input.raw.wallBody === null || input.raw.wallBody.length === 0
      ? null
      : input.raw.wallBody;

  // Knowledge infrastructure down is not a hard spam/unsafe block: elevate to
  // eligible recovery so a bounded honest reply can be written downstream.
  // Missing replyText must never be labelled knowledge_unavailable.
  const reasonForPolicy =
    !input.knowledgeAvailable &&
    !["spam_or_noise", "unsafe_or_injection"].includes(input.raw.reasonCode)
      ? "insufficient_knowledge"
      : input.raw.reasonCode;

  const guaranteed = applyReplyGuaranteePolicy({
    engage: input.raw.engage,
    action: input.raw.action,
    reasonCode: reasonForPolicy,
    replyText,
    wallBody,
    allowDeferredLiveSilence,
  });

  return {
    engage: guaranteed.engage,
    action: guaranteed.action,
    reasonCode: guaranteed.reasonCode,
    replyText:
      guaranteed.replyText === null
        ? null
        : guaranteed.replyText.slice(0, STAGE12_X_REPLY_MAX_CHARS),
    wallBody:
      guaranteed.wallBody === null
        ? null
        : guaranteed.wallBody.slice(0, WALL_BODY_MAX_CHARS),
    needsLiveState: live,
    identityUnverified,
    knowledgeAvailable: input.knowledgeAvailable,
    model: input.model,
    promptVersion: input.promptVersion,
  };
}

/**
 * Normalise a raw action string that may include legacy wall-only
 * (e.g. tests or defensive re-parse paths). Fail closed for wall-only.
 */
export function failClosedLegacyWallOnlyAction(): "do_nothing" {
  return "do_nothing";
}
