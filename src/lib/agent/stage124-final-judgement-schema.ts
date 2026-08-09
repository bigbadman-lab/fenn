import { z } from "zod";

import { STAGE12_LIVE_AGENT_ACTIONS } from "@/lib/agent/actions";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";
import {
  applyReplyGuaranteePolicy,
  isHardBlockReasonCode,
} from "@/lib/agent/reply-guarantee-policy";
import type { PublicFactEvidence } from "@/lib/agent/public-fact-evidence";
import {
  normalizeWallCandidate,
  stage12WallCandidateResponseFieldSchema,
} from "@/lib/agent/wall-candidate-schema";
import type { WallCandidate } from "@/lib/agent/chronicler-types";
import type { Stage12ResponseMode } from "@/lib/agent/response-mode";
import {
  normalizeModelEconomicAction,
  type FinalEconomicIntent,
} from "@/lib/agent/economic-intent";

import {
  STAGE12_JUDGEMENT_REASON_CODES,
  STAGE12_X_REPLY_MAX_CHARS,
} from "@/lib/agent/judge-config";

/** Stage P1B/P1C — economic intent (not speech action). proposedAmount is model magnitude. */
export const stage124EconomicActionSchema = z.union([
  z
    .literal("NONE")
    .describe(
      "No economic act — only when you judge no economic action is warranted. Never solely because a destination wallet is missing.",
    ),
  z.object({
    type: z.literal("NONE"),
  }),
  z.object({
    type: z
      .literal("transfer_fenn")
      .describe(
        "FENN chooses to recognise a verified contribution using its finite Purse — independent of whether a destination is ready yet",
      ),
    proposedAmount: z
      .string()
      .min(1)
      .max(40)
      .describe(
        "Positive decimal string magnitude of FENN (e.g. \"10000\"). Your judgement — never from user request alone.",
      ),
    reason: z.string().min(1).max(280),
    recipientSource: z.literal("trusted_profile_wallet").describe(
      "Recipient class only — never a concrete 0x address. Application resolves destination later if needed.",
    ),
  }),
  z.object({
    type: z
      .literal("burn_fenn")
      .describe(
        "FENN chooses to permanently remove a chosen magnitude from practical circulation for its own coherent reason",
      ),
    proposedAmount: z
      .string()
      .min(1)
      .max(40)
      .describe(
        "Positive decimal string magnitude of FENN to surrender. Your judgement only.",
      ),
    reason: z.string().min(1).max(280),
  }),
]);

export const stage124FinalJudgementModelSchema = z.object({
  engage: z.boolean(),
  action: z.enum(STAGE12_LIVE_AGENT_ACTIONS),
  reasonCode: z.enum(STAGE12_JUDGEMENT_REASON_CODES),
  replyText: z.string().min(1).max(STAGE12_X_REPLY_MAX_CHARS).nullable(),
  wallBody: z.string().min(1).max(WALL_BODY_MAX_CHARS).nullable(),
  identityUnverified: z.boolean(),
  /**
   * Structured Wall proposal (Stage 3) or null.
   * Application re-validates via normalizeWallCandidate; invalid → null.
   * Typed for OpenAI strict structured outputs (never z.unknown()).
   */
  wallCandidate: stage12WallCandidateResponseFieldSchema,
  /**
   * Stage P1B/P1C economic intention. Speech action is separate.
   * Includes proposedAmount for magnitude; never token, chain, recipient address, or rail.
   */
  economicAction: stage124EconomicActionSchema.optional().default("NONE"),
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
  economicIntent: FinalEconomicIntent;
};

/**
 * Final judgement normaliser: visible-reply guarantee after live state.
 * Soft silence and empty action are elevated to reply when drafts exist.
 * Never wall-only. No deferred live silence (this is the final stage).
 * Economic intent is wiped on hard blocks; malformed economic → NONE.
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

  let economicIntent: FinalEconomicIntent = { type: "NONE" };
  try {
    economicIntent = normalizeModelEconomicAction(
      input.raw.economicAction ?? "NONE",
    );
  } catch {
    economicIntent = { type: "NONE" };
  }

  // Never plan spend on hard silence / injection.
  if (isHardBlockReasonCode(guaranteed.reasonCode)) {
    economicIntent = { type: "NONE" };
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
    economicIntent,
  };
}
