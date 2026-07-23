import "server-only";

import { zodResponseFormat } from "openai/helpers/zod";

import { getCampCharacterConfig } from "@/lib/camp/characters";
import {
  CAMP_MAX_COMPLETION_TOKENS,
  CAMP_OPENAI_MODEL,
} from "@/lib/camp/config";
import { CampAiError } from "@/lib/camp/errors";
import {
  campStructuredAiResultSchema,
  parseCampStructuredAiResult,
} from "@/lib/camp/evaluation";
import {
  boundCampConversationHistory,
  validateCampUserMessage,
} from "@/lib/camp/history";
import type {
  CampStructuredAiResult,
  CampTurnInput,
  CampTurnResult,
} from "@/lib/camp/types";

export type CampModelCaller = (args: {
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxCompletionTokens: number;
}) => Promise<CampStructuredAiResult>;

function buildSystemWithOutlaw(
  base: string,
  outlawNumber: number | null | undefined,
): string {
  if (outlawNumber == null || !Number.isFinite(outlawNumber)) {
    return base;
  }
  const padded = String(Math.trunc(outlawNumber)).padStart(5, "0");
  return `${base}\n\nThe speaker is registered Outlaw ${padded}. Address them as an Outlaw when it fits; do not recite their number every turn.`;
}

function isTimeoutLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; code?: string; name?: string };
  return e.status === 408 || e.code === "timeout" || e.name === "APIConnectionTimeoutError";
}

async function defaultCampModelCaller(args: {
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxCompletionTokens: number;
}): Promise<CampStructuredAiResult> {
  const { getOpenAIClient, OpenAIUnavailableError } = await import(
    "@/lib/ai/openai"
  );

  let client;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof OpenAIUnavailableError) {
      throw new CampAiError(
        "camp_ai_unavailable",
        "Camp intelligence is not configured",
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
        ...args.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ],
      response_format: zodResponseFormat(
        campStructuredAiResultSchema,
        "camp_turn_result",
      ),
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new CampAiError(
        "camp_ai_invalid_response",
        "Model returned no structured result",
        502,
      );
    }
    return parseCampStructuredAiResult(parsed);
  } catch (error) {
    if (error instanceof CampAiError) throw error;
    if (isTimeoutLike(error)) {
      throw new CampAiError(
        "camp_ai_timeout",
        "Camp intelligence timed out",
        504,
      );
    }
    throw new CampAiError(
      "camp_ai_invalid_response",
      "Camp intelligence failed",
      502,
    );
  }
}

/**
 * Canonical Camp character turn — no DB, no LEAF, no memory writes.
 * Non-streaming. One model call with structured private evaluation.
 */
export async function runCampCharacterTurn(
  input: CampTurnInput,
  options?: { callModel?: CampModelCaller },
): Promise<CampTurnResult> {
  const character = getCampCharacterConfig(input.promptKey);
  const userMessage = validateCampUserMessage(input.userMessage);
  const history = boundCampConversationHistory(input.conversationHistory);

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history,
    { role: "user", content: userMessage },
  ];

  const system = buildSystemWithOutlaw(
    character.systemInstructions,
    input.outlawNumber,
  );

  const callModel = options?.callModel ?? defaultCampModelCaller;

  let structured: CampStructuredAiResult;
  try {
    structured = await callModel({
      model: CAMP_OPENAI_MODEL,
      system,
      messages,
      maxCompletionTokens: CAMP_MAX_COMPLETION_TOKENS,
    });
  } catch (error) {
    if (error instanceof CampAiError) throw error;
    throw new CampAiError(
      "camp_ai_invalid_response",
      "Camp intelligence failed",
      502,
    );
  }

  let validated: CampStructuredAiResult;
  try {
    validated = parseCampStructuredAiResult(structured);
  } catch {
    // One controlled retry for live default caller only (malformed structured output).
    if (!options?.callModel) {
      try {
        structured = await defaultCampModelCaller({
          model: CAMP_OPENAI_MODEL,
          system,
          messages,
          maxCompletionTokens: CAMP_MAX_COMPLETION_TOKENS,
        });
        validated = parseCampStructuredAiResult(structured);
      } catch {
        throw new CampAiError(
          "camp_ai_invalid_response",
          "Model returned invalid structured result",
          502,
        );
      }
    } else {
      throw new CampAiError(
        "camp_ai_invalid_response",
        "Model returned invalid structured result",
        502,
      );
    }
  }

  return {
    character,
    reply: validated.reply,
    evaluation: validated.evaluation,
    model: CAMP_OPENAI_MODEL,
    promptVersion: character.version,
  };
}
