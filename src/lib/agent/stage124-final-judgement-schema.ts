import { z } from "zod";

import { STAGE12_LIVE_AGENT_ACTIONS } from "@/lib/agent/actions";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";
import { applyReplyGuaranteePolicy } from "@/lib/agent/reply-guarantee-policy";
import type { PublicFactEvidence } from "@/lib/agent/public-fact-evidence";
import { normalizeWallCandidate } from "@/lib/agent/wall-candidate-schema";
import type { WallCandidate } from "@/lib/agent/chronicler-types";
import type { Stage12ResponseMode } from "@/lib/agent/response-mode";

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
  /**
   * Optional structured Wall proposal (Stage 3).
   * Application re-validates against trusted evidence; invalid → null.
   */
  wallCandidate: z.unknown().nullable().optional(),
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
  wallCandidate: WallCandidate | null;
};

/**
 * Final judgement normaliser: visible-reply guarantee after live state.
 * Soft silence and empty action are elevated to reply when drafts exist.
 * Never wall-only. No deferred live silence (this is the final stage).
 */
export function normalizeStage124FinalJudgementIntention(input: {
  raw: Stage124FinalJudgementModelOutput;
  knowledgeAvailable: boolean;
  liveStateAnyAvailable: boolean;
  model: string;
  promptVersion: string;
  trustedFacts?: readonly PublicFactEvidence[] | null;
  responseMode?: Stage12ResponseMode | null;
}): Stage124FinalJudgementIntention {
  const { identityUnverified } = input.raw;

  const canGround = input.knowledgeAvailable || input.liveStateAnyAvailable;

  const replyText =
    input.raw.replyText === null || input.raw.replyText.trim().length === 0
      ? null
      : input.raw.replyText.slice(0, STAGE12_X_REPLY_MAX_CHARS);
  const wallBody =
    input.raw.wallBody === null || input.raw.wallBody.length === 0
      ? null
      : input.raw.wallBody.slice(0, WALL_BODY_MAX_CHARS);

  const reasonForPolicy = !canGround
    ? input.raw.reasonCode === "spam_or_noise" ||
      input.raw.reasonCode === "unsafe_or_injection"
      ? input.raw.reasonCode
      : "insufficient_knowledge"
    : input.raw.reasonCode;

  const guaranteed = applyReplyGuaranteePolicy({
    engage: !canGround ? true : input.raw.engage,
    action: !canGround ? "reply_on_x" : input.raw.action,
    reasonCode: reasonForPolicy,
    replyText: !canGround ? null : replyText,
    wallBody: !canGround ? null : wallBody,
    allowDeferredLiveSilence: false,
  });

  const action = guaranteed.action;
  const finalWall = guaranteed.wallBody;
  let wallCandidate = normalizeWallCandidate({
    raw: input.raw.wallCandidate ?? null,
    action,
    responseMode: input.responseMode,
    trustedFacts: input.trustedFacts,
  });

  if (action !== "reply_and_write_to_wall") {
    wallCandidate = null;
  }

  return {
    engage: guaranteed.engage,
    action,
    reasonCode: guaranteed.reasonCode,
    replyText: guaranteed.replyText,
    wallBody: finalWall,
    identityUnverified,
    knowledgeAvailable: input.knowledgeAvailable,
    liveStateAnyAvailable: input.liveStateAnyAvailable,
    model: input.model,
    promptVersion: input.promptVersion,
    wallCandidate,
  };
}
