import { z } from "zod";

import { STAGE12_AGENT_ACTIONS } from "@/lib/agent/actions";
import {
  STAGE12_JUDGEMENT_REASON_CODES,
  STAGE12_X_REPLY_MAX_CHARS,
} from "@/lib/agent/judge-config";
import { FENN_LIVE_CAPABILITIES } from "@/lib/agent/live-state";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";

/**
 * Structured judgement the model may emit.
 * Application owns provenance, execution, and authority fields.
 */
export const stage12JudgementModelSchema = z.object({
  /** Attention: does this event warrant any engagement? */
  engage: z.boolean(),
  action: z.enum(STAGE12_AGENT_ACTIONS),
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
 * Enforce action/content consistency and Stage 12.3 safety post-conditions.
 * Does not invent live answers. Does not execute.
 */
export function normalizeJudgementIntention(input: {
  raw: Stage12JudgementModelOutput;
  knowledgeAvailable: boolean;
  model: string;
  promptVersion: string;
}): Stage12JudgementIntention {
  let {
    engage,
    action,
    reasonCode,
    replyText,
    wallBody,
  } = input.raw;
  const { needsLiveState, identityUnverified } = input.raw;

  // Deduplicate live-state requests; only allow known capabilities (schema already).
  const live = [...new Set(needsLiveState)];

  // Knowledge infrastructure down → conservative silence.
  if (!input.knowledgeAvailable) {
    engage = false;
    action = "do_nothing";
    reasonCode = "knowledge_unavailable";
    replyText = null;
    wallBody = null;
    // Keep live/identity flags for observability but do not act.
  }

  // Attention gate: no engagement → silence.
  if (!engage) {
    action = "do_nothing";
    replyText = null;
    wallBody = null;
    if (
      reasonCode === "answered_from_public_knowledge" ||
      reasonCode === "creative_world_action"
    ) {
      reasonCode = "no_response_warranted";
    }
  }

  // Empty strings → null (except wallBody preserves intentional whitespace-only? treat empty as null)
  const reply =
    replyText === null || replyText.trim().length === 0 ? null : replyText;
  // Preserve internal ASCII whitespace; only drop if length 0.
  const wall =
    wallBody === null || wallBody.length === 0 ? null : wallBody;

  if (action === "do_nothing") {
    return {
      engage: false,
      action,
      reasonCode,
      replyText: null,
      wallBody: null,
      needsLiveState: live,
      identityUnverified,
      knowledgeAvailable: input.knowledgeAvailable,
      model: input.model,
      promptVersion: input.promptVersion,
    };
  }

  if (action === "reply_on_x") {
    if (!reply) {
      return silenceFallback(
        input,
        live,
        identityUnverified,
        "insufficient_knowledge",
      );
    }
    return {
      engage: true,
      action,
      reasonCode,
      replyText: reply.slice(0, STAGE12_X_REPLY_MAX_CHARS),
      wallBody: null,
      needsLiveState: live,
      identityUnverified,
      knowledgeAvailable: input.knowledgeAvailable,
      model: input.model,
      promptVersion: input.promptVersion,
    };
  }

  if (action === "write_to_wall") {
    if (!wall) {
      return silenceFallback(
        input,
        live,
        identityUnverified,
        "insufficient_knowledge",
      );
    }
    return {
      engage: true,
      action,
      reasonCode:
        reasonCode === "answered_from_public_knowledge"
          ? "creative_world_action"
          : reasonCode,
      replyText: null,
      wallBody: wall.slice(0, WALL_BODY_MAX_CHARS),
      needsLiveState: live,
      identityUnverified,
      knowledgeAvailable: input.knowledgeAvailable,
      model: input.model,
      promptVersion: input.promptVersion,
    };
  }

  // reply_and_write_to_wall
  if (!reply || !wall) {
    if (reply && !wall) {
      return {
        engage: true,
        action: "reply_on_x",
        reasonCode,
        replyText: reply.slice(0, STAGE12_X_REPLY_MAX_CHARS),
        wallBody: null,
        needsLiveState: live,
        identityUnverified,
        knowledgeAvailable: input.knowledgeAvailable,
        model: input.model,
        promptVersion: input.promptVersion,
      };
    }
    if (wall && !reply) {
      return {
        engage: true,
        action: "write_to_wall",
        reasonCode: "creative_world_action",
        replyText: null,
        wallBody: wall.slice(0, WALL_BODY_MAX_CHARS),
        needsLiveState: live,
        identityUnverified,
        knowledgeAvailable: input.knowledgeAvailable,
        model: input.model,
        promptVersion: input.promptVersion,
      };
    }
    return silenceFallback(
      input,
      live,
      identityUnverified,
      "insufficient_knowledge",
    );
  }

  return {
    engage: true,
    action: "reply_and_write_to_wall",
    reasonCode:
      reasonCode === "answered_from_public_knowledge"
        ? "creative_world_action"
        : reasonCode,
    replyText: reply.slice(0, STAGE12_X_REPLY_MAX_CHARS),
    wallBody: wall.slice(0, WALL_BODY_MAX_CHARS),
    needsLiveState: live,
    identityUnverified,
    knowledgeAvailable: input.knowledgeAvailable,
    model: input.model,
    promptVersion: input.promptVersion,
  };
}

function silenceFallback(
  input: {
    knowledgeAvailable: boolean;
    model: string;
    promptVersion: string;
  },
  live: Stage12JudgementModelOutput["needsLiveState"],
  identityUnverified: boolean,
  reasonCode: (typeof STAGE12_JUDGEMENT_REASON_CODES)[number],
): Stage12JudgementIntention {
  return {
    engage: false,
    action: "do_nothing",
    reasonCode,
    replyText: null,
    wallBody: null,
    needsLiveState: live,
    identityUnverified,
    knowledgeAvailable: input.knowledgeAvailable,
    model: input.model,
    promptVersion: input.promptVersion,
  };
}
