import "server-only";

import { zodResponseFormat } from "openai/helpers/zod";

import {
  STAGE12_JUDGE_MAX_COMPLETION_TOKENS,
  STAGE12_JUDGE_OPENAI_MODEL,
  STAGE12_JUDGE_PROMPT_VERSION,
} from "@/lib/agent/judge-config";
import { AgentJudgeError } from "@/lib/agent/judge-errors";
import {
  buildFennPublicJudgeSystemPrompt,
  buildFennPublicJudgeUserPayload,
} from "@/lib/agent/judge-prompt";
import {
  normalizeJudgementIntention,
  parseJudgementModelOutput,
  stage12JudgementModelSchema,
  type Stage12JudgementIntention,
  type Stage12JudgementModelOutput,
} from "@/lib/agent/judge-schema";

export type JudgeModelCaller = (args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}) => Promise<Stage12JudgementModelOutput>;

function isTimeoutLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; code?: string; name?: string };
  return (
    e.status === 408 ||
    e.code === "timeout" ||
    e.name === "APIConnectionTimeoutError"
  );
}

async function defaultJudgeModelCaller(args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}): Promise<Stage12JudgementModelOutput> {
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
        "FENN judgement model is not configured",
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
        stage12JudgementModelSchema,
        "fenn_public_judgement",
      ),
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new AgentJudgeError(
        "judge_invalid_response",
        "Judgement model returned no structured result",
        502,
      );
    }
    return parseJudgementModelOutput(parsed);
  } catch (error) {
    if (error instanceof AgentJudgeError) throw error;
    if (isTimeoutLike(error)) {
      throw new AgentJudgeError(
        "judge_timeout",
        "Judgement model timed out",
        504,
      );
    }
    throw new AgentJudgeError(
      "judge_invalid_response",
      "Judgement model failed",
      502,
    );
  }
}

/**
 * Run structured FENN public judgement (no persistence, no execution).
 */
export async function runFennPublicJudgement(input: {
  xPostId: string;
  perceptionType: string;
  authorXUserId: string;
  authorUsername: string | null;
  body: string;
  knowledgeAvailable: boolean;
  knowledgeContext: string | null;
  callModel?: JudgeModelCaller;
}): Promise<Stage12JudgementIntention> {
  const callModel = input.callModel ?? defaultJudgeModelCaller;
  const system = buildFennPublicJudgeSystemPrompt();
  const user = buildFennPublicJudgeUserPayload({
    xPostId: input.xPostId,
    perceptionType: input.perceptionType,
    authorXUserId: input.authorXUserId,
    authorUsername: input.authorUsername,
    body: input.body,
    knowledgeAvailable: input.knowledgeAvailable,
    knowledgeContext: input.knowledgeContext,
  });

  const invoke = async () => {
    const raw = await callModel({
      model: STAGE12_JUDGE_OPENAI_MODEL,
      system,
      user,
      maxCompletionTokens: STAGE12_JUDGE_MAX_COMPLETION_TOKENS,
    });
    return parseJudgementModelOutput(raw);
  };

  let raw: Stage12JudgementModelOutput;
  try {
    raw = await invoke();
  } catch (error) {
    // One controlled retry for live default caller only (malformed structured output).
    if (!input.callModel) {
      try {
        raw = await invoke();
      } catch {
        if (error instanceof AgentJudgeError) throw error;
        throw new AgentJudgeError(
          "judge_invalid_response",
          "Judgement model returned invalid structured result",
          502,
        );
      }
    } else if (error instanceof AgentJudgeError) {
      throw error;
    } else {
      throw new AgentJudgeError(
        "judge_invalid_response",
        "Judgement model returned invalid structured result",
        502,
      );
    }
  }

  return normalizeJudgementIntention({
    raw,
    knowledgeAvailable: input.knowledgeAvailable,
    model: STAGE12_JUDGE_OPENAI_MODEL,
    promptVersion: STAGE12_JUDGE_PROMPT_VERSION,
  });
}
