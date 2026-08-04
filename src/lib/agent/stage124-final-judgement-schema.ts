import { z } from "zod";

import { STAGE12_LIVE_AGENT_ACTIONS } from "@/lib/agent/actions";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";

import {
  STAGE12_JUDGEMENT_REASON_CODES,
  STAGE12_X_REPLY_MAX_CHARS,
} from "@/lib/agent/judge-config";

export const stage124FinalJudgementModelSchema = z.object({
  engage: z.boolean(),
  action: z.enum(STAGE12_LIVE_AGENT_ACTIONS),
  reasonCode: z.enum(STAGE12_JUDGEMENT_REASON_CODES),
  replyText: z.string().min(1).max(STAGE12_X_REPLY_MAX_CHARS).nullable(),
  wallBody: z.string().min(1).max(WALL_BODY_MAX_CHARS).nullable(),
  identityUnverified: z.boolean(),
});

export type Stage124FinalJudgementModelOutput = z.infer<
  typeof stage124FinalJudgementModelSchema
>;

export type Stage124FinalJudgementIntention = {
  engage: boolean;
  action: Stage124FinalJudgementModelOutput["action"];
  reasonCode: Stage124FinalJudgementModelOutput["reasonCode"];
  replyText: string | null;
  wallBody: string | null;
  identityUnverified: boolean;
  knowledgeAvailable: boolean;
  liveStateAnyAvailable: boolean;
  model: string;
  promptVersion: string;
};

export function normalizeStage124FinalJudgementIntention(input: {
  raw: Stage124FinalJudgementModelOutput;
  knowledgeAvailable: boolean;
  liveStateAnyAvailable: boolean;
  model: string;
  promptVersion: string;
}): Stage124FinalJudgementIntention {
  const {
    engage,
    action,
    reasonCode,
    replyText,
    wallBody,
    identityUnverified,
  } = input.raw;

  const canGround = input.knowledgeAvailable || input.liveStateAnyAvailable;
  if (!canGround) {
    return {
      engage: false,
      action: "do_nothing",
      reasonCode: "knowledge_unavailable",
      replyText: null,
      wallBody: null,
      identityUnverified,
      knowledgeAvailable: input.knowledgeAvailable,
      liveStateAnyAvailable: input.liveStateAnyAvailable,
      model: input.model,
      promptVersion: input.promptVersion,
    };
  }

  // Attention gate: if model says no engagement, FENN must remain silent.
  if (!engage) {
    return {
      engage: false,
      action: "do_nothing",
      reasonCode: "no_response_warranted",
      replyText: null,
      wallBody: null,
      identityUnverified,
      knowledgeAvailable: input.knowledgeAvailable,
      liveStateAnyAvailable: input.liveStateAnyAvailable,
      model: input.model,
      promptVersion: input.promptVersion,
    };
  }

  // Output consistency checks: content must exist for the chosen action.
  if (action === "reply_on_x") {
    if (!replyText) {
      return silenceFallback(input, "insufficient_knowledge");
    }
    return {
      engage: true,
      action,
      reasonCode,
      replyText,
      wallBody: null,
      identityUnverified,
      knowledgeAvailable: input.knowledgeAvailable,
      liveStateAnyAvailable: input.liveStateAnyAvailable,
      model: input.model,
      promptVersion: input.promptVersion,
    };
  }

  if (action === "reply_and_write_to_wall") {
    if (replyText && wallBody) {
      return {
        engage: true,
        action,
        reasonCode,
        replyText,
        wallBody,
        identityUnverified,
        knowledgeAvailable: input.knowledgeAvailable,
        liveStateAnyAvailable: input.liveStateAnyAvailable,
        model: input.model,
        promptVersion: input.promptVersion,
      };
    }
    // Missing wall + valid reply → reply only (never wall-only)
    if (replyText && !wallBody) {
      return {
        engage: true,
        action: "reply_on_x",
        reasonCode,
        replyText,
        wallBody: null,
        identityUnverified,
        knowledgeAvailable: input.knowledgeAvailable,
        liveStateAnyAvailable: input.liveStateAnyAvailable,
        model: input.model,
        promptVersion: input.promptVersion,
      };
    }
    // Missing reply with or without wall → silence (never wall-only)
    return silenceFallback(input, "insufficient_knowledge");
  }

  // do_nothing: wipe candidates.
  if (action === "do_nothing") {
    return {
      engage: false,
      action: "do_nothing",
      reasonCode,
      replyText: null,
      wallBody: null,
      identityUnverified,
      knowledgeAvailable: input.knowledgeAvailable,
      liveStateAnyAvailable: input.liveStateAnyAvailable,
      model: input.model,
      promptVersion: input.promptVersion,
    };
  }

  // Should be unreachable due to enum.
  return silenceFallback(input, "insufficient_knowledge");
}

function silenceFallback(
  input: {
    knowledgeAvailable: boolean;
    liveStateAnyAvailable: boolean;
    model: string;
    promptVersion: string;
    raw: Stage124FinalJudgementModelOutput;
  },
  reasonCode: Stage124FinalJudgementModelOutput["reasonCode"],
): Stage124FinalJudgementIntention {
  return {
    engage: false,
    action: "do_nothing",
    reasonCode,
    replyText: null,
    wallBody: null,
    identityUnverified: input.raw.identityUnverified,
    knowledgeAvailable: input.knowledgeAvailable,
    liveStateAnyAvailable: input.liveStateAnyAvailable,
    model: input.model,
    promptVersion: input.promptVersion,
  };
}
