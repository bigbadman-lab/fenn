import "server-only";

import { zodResponseFormat } from "openai/helpers/zod";

import {
  STAGE12_JUDGE_MAX_COMPLETION_TOKENS,
  STAGE12_JUDGE_OPENAI_MODEL,
} from "@/lib/agent/judge-config";
import { AgentJudgeError } from "@/lib/agent/judge-errors";

import {
  buildFennPublicFinalJudgeSystemPrompt,
  buildFennPublicFinalJudgeUserPayload,
  STAGE124_FINAL_PROMPT_VERSION,
} from "@/lib/agent/stage124-final-judge-prompt";

import {
  normalizeStage124FinalJudgementIntention,
  parseStage124FinalJudgementModelOutput,
  type Stage124FinalJudgementIntention,
  type Stage124FinalJudgementModelOutput,
} from "@/lib/agent/stage124-final-judgement-helpers";
import { stage124FinalJudgementModelSchema } from "@/lib/agent/stage124-final-judgement-schema";

export type Stage124FinalJudgeModelCaller = (args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}) => Promise<Stage124FinalJudgementModelOutput>;

function isTimeoutLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; code?: string; name?: string };
  return (
    e.status === 408 || e.code === "timeout" || e.name === "APIConnectionTimeoutError"
  );
}

async function defaultStage124FinalJudgeModelCaller(args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}): Promise<Stage124FinalJudgementModelOutput> {
  const { getOpenAIClient, OpenAIUnavailableError } = await import(
    "@/lib/ai/openai"
  );

  let client;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof OpenAIUnavailableError) {
      throw new AgentJudgeError(
        "judge_unavailable",
        "FENN final judgement model is not configured",
        503,
      );
    }
    throw error;
  }

  try {
    const completion = await client.chat.completions.parse({
      model: args.model,
      max_completion_tokens: args.maxCompletionTokens,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      response_format: zodResponseFormat(
        stage124FinalJudgementModelSchema,
        "fenn_public_final_judgement",
      ),
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new AgentJudgeError(
        "judge_invalid_response",
        "Final judgement model returned no structured result",
        502,
      );
    }

    return parseStage124FinalJudgementModelOutput(parsed);
  } catch (error) {
    if (error instanceof AgentJudgeError) throw error;
    if (isTimeoutLike(error)) {
      throw new AgentJudgeError(
        "judge_timeout",
        "Final judgement model timed out",
        504,
      );
    }
    throw new AgentJudgeError(
      "judge_invalid_response",
      "Final judgement model failed",
      502,
    );
  }
}

export async function runFennPublicFinalJudgement(input: {
  xPostId: string;
  perceptionType: string;
  authorXUserId: string;
  authorUsername: string | null;
  body: string;
  knowledgeAvailable: boolean;
  knowledgeContext: string | null;
  trustedLiveStateBlock: string;
  liveStateAnyAvailable: boolean;
  publicFactEvidenceBlock?: string | null;
  trustedFacts?: import("@/lib/agent/public-fact-evidence").PublicFactEvidence[] | null;
  callModel?: Stage124FinalJudgeModelCaller;
}): Promise<Stage124FinalJudgementIntention> {
  const callModel = input.callModel ?? defaultStage124FinalJudgeModelCaller;
  const system = buildFennPublicFinalJudgeSystemPrompt();
  const user = buildFennPublicFinalJudgeUserPayload({
    xPostId: input.xPostId,
    perceptionType: input.perceptionType,
    authorXUserId: input.authorXUserId,
    authorUsername: input.authorUsername,
    body: input.body,
    knowledgeAvailable: input.knowledgeAvailable,
    knowledgeContext: input.knowledgeContext,
    trustedLiveStateBlock: input.trustedLiveStateBlock,
    publicFactEvidenceBlock: input.publicFactEvidenceBlock ?? null,
  });

  let raw: Stage124FinalJudgementModelOutput;
  try {
    raw = await callModel({
      model: STAGE12_JUDGE_OPENAI_MODEL,
      system,
      user,
      maxCompletionTokens: STAGE12_JUDGE_MAX_COMPLETION_TOKENS,
    });
  } catch (error) {
    if (!input.callModel && error instanceof AgentJudgeError) {
      // One controlled retry for the default caller.
      raw = await defaultStage124FinalJudgeModelCaller({
        model: STAGE12_JUDGE_OPENAI_MODEL,
        system,
        user,
        maxCompletionTokens: STAGE12_JUDGE_MAX_COMPLETION_TOKENS,
      });
    } else {
      throw error;
    }
  }

  return normalizeStage124FinalJudgementIntention({
    raw,
    knowledgeAvailable: input.knowledgeAvailable,
    liveStateAnyAvailable: input.liveStateAnyAvailable,
    model: STAGE12_JUDGE_OPENAI_MODEL,
    promptVersion: STAGE124_FINAL_PROMPT_VERSION,
    trustedFacts: input.trustedFacts ?? [],
  });
}

