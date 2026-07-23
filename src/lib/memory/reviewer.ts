import "server-only";

import { zodResponseFormat } from "openai/helpers/zod";

import {
  MEMORY_REVIEW_MAX_COMPLETION_TOKENS,
  MEMORY_REVIEW_OPENAI_MODEL,
} from "@/lib/memory/config";
import { MemoryReviewError } from "@/lib/memory/errors";
import {
  buildMemoryReviewerSystemPrompt,
  buildMemoryReviewerUserPayload,
} from "@/lib/memory/review-prompt";
import {
  assertReviewResultHasNoAuthorityFields,
  memoryReviewResultSchema,
  parseMemoryReviewResult,
  type MemoryReviewResult,
} from "@/lib/memory/review-schema";

export type MemoryReviewModelCaller = (args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}) => Promise<MemoryReviewResult>;

function isTimeoutLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; code?: string; name?: string };
  return (
    e.status === 408 ||
    e.code === "timeout" ||
    e.name === "APIConnectionTimeoutError"
  );
}

async function defaultMemoryReviewModelCaller(args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}): Promise<MemoryReviewResult> {
  const { getOpenAIClient, OpenAIUnavailableError } = await import(
    "@/lib/ai/openai"
  );

  let client;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof OpenAIUnavailableError) {
      throw new MemoryReviewError(
        "memory_review_unavailable",
        "Memory reviewer is not configured",
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
        memoryReviewResultSchema,
        "memory_review_result",
      ),
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new MemoryReviewError(
        "memory_review_invalid_response",
        "Memory reviewer returned no structured result",
        502,
      );
    }
    assertReviewResultHasNoAuthorityFields(parsed);
    return parseMemoryReviewResult(parsed);
  } catch (error) {
    if (error instanceof MemoryReviewError) throw error;
    if (isTimeoutLike(error)) {
      throw new MemoryReviewError(
        "memory_review_timeout",
        "Memory reviewer timed out",
        504,
      );
    }
    throw new MemoryReviewError(
      "memory_review_invalid_response",
      "Memory reviewer failed",
      502,
    );
  }
}

/**
 * Call the independent memory reviewer model.
 * Does not write to the database.
 */
export async function reviewMemoryCandidateContent(input: {
  candidateId: string;
  content: string;
  characterId: string | null;
  callModel?: MemoryReviewModelCaller;
}): Promise<MemoryReviewResult> {
  const callModel = input.callModel ?? defaultMemoryReviewModelCaller;
  const system = buildMemoryReviewerSystemPrompt();
  const user = buildMemoryReviewerUserPayload({
    candidateId: input.candidateId,
    content: input.content,
    characterId: input.characterId,
  });

  const raw = await callModel({
    model: MEMORY_REVIEW_OPENAI_MODEL,
    system,
    user,
    maxCompletionTokens: MEMORY_REVIEW_MAX_COMPLETION_TOKENS,
  });

  assertReviewResultHasNoAuthorityFields(raw);
  return parseMemoryReviewResult(raw);
}
