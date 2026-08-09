/**
 * Stage P1E — fact-locked Book of Speech writer for economic completion.
 */

import "server-only";

import { zodResponseFormat } from "openai/helpers/zod";

import {
  STAGE12_JUDGE_MAX_COMPLETION_TOKENS,
  STAGE12_JUDGE_OPENAI_MODEL,
} from "@/lib/agent/judge-config";
import {
  parseReplyRecoveryModelOutput,
  sanitizeReplyCandidate,
  stage12ReplyRecoveryModelSchema,
  type Stage12ReplyRecoveryModelOutput,
} from "@/lib/agent/reply-recovery-schema";
import {
  buildEconomicCompletionFallback,
  type EconomicCompletionFacts,
  validateEconomicCompletionSpeech,
} from "@/lib/agent/economic-followup";
import {
  buildEconomicCompletionSpeechSystemPrompt,
  buildEconomicCompletionSpeechUserPayload,
  ECONOMIC_COMPLETION_SPEECH_PROMPT_VERSION,
} from "@/lib/agent/economic-completion-prompt";

export type EconomicCompletionSpeechModelCaller = (args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}) => Promise<Stage12ReplyRecoveryModelOutput>;

export type EconomicCompletionSpeechResult = {
  replyText: string;
  source: "book_of_speech" | "fallback";
  usedFallback: boolean;
  promptVersion: typeof ECONOMIC_COMPLETION_SPEECH_PROMPT_VERSION;
  validationReasons: string[];
};

function isTimeoutLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; code?: string; name?: string };
  return (
    e.status === 408 ||
    e.code === "timeout" ||
    e.name === "APIConnectionTimeoutError"
  );
}

async function defaultCaller(args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}): Promise<Stage12ReplyRecoveryModelOutput> {
  const { getOpenAIClient, OpenAIUnavailableError } = await import(
    "@/lib/ai/openai"
  );
  let client;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof OpenAIUnavailableError) {
      throw new Error("economic completion speech model is not configured");
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
        stage12ReplyRecoveryModelSchema,
        "fenn_economic_completion_speech",
      ),
    });
    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new Error("economic completion speech model returned no result");
    }
    return parseReplyRecoveryModelOutput(parsed);
  } catch (error) {
    if (isTimeoutLike(error)) {
      throw new Error("economic completion speech model timed out");
    }
    if (error instanceof Error) throw error;
    throw new Error("economic completion speech model failed");
  }
}

function fallback(
  facts: EconomicCompletionFacts,
  reasons: string[],
): EconomicCompletionSpeechResult {
  console.info("[p1e-economic-completion] fallback_voice", {
    actionType: facts.actionType,
    economicEffectId: facts.economicEffectId,
    reasons,
  });
  return {
    replyText: buildEconomicCompletionFallback(facts),
    source: "fallback",
    usedFallback: true,
    promptVersion: ECONOMIC_COMPLETION_SPEECH_PROMPT_VERSION,
    validationReasons: reasons,
  };
}

/**
 * Render completion reply under Book of Speech with fact validation.
 * Never throws for model failure — returns deterministic fallback.
 */
export async function renderEconomicCompletionSpeech(input: {
  facts: EconomicCompletionFacts;
  callModel?: EconomicCompletionSpeechModelCaller;
  forceFallback?: boolean;
}): Promise<EconomicCompletionSpeechResult> {
  const { facts } = input;
  if (input.forceFallback) {
    return fallback(facts, ["force_fallback"]);
  }

  const callModel = input.callModel ?? defaultCaller;
  const system = buildEconomicCompletionSpeechSystemPrompt();
  const user = buildEconomicCompletionSpeechUserPayload(facts);

  try {
    const raw = await callModel({
      model: STAGE12_JUDGE_OPENAI_MODEL,
      system,
      user,
      maxCompletionTokens: Math.min(STAGE12_JUDGE_MAX_COMPLETION_TOKENS, 320),
    });
    let clean = sanitizeReplyCandidate(raw.replyText);
    if (!clean) return fallback(facts, ["sanitize_failed"]);

    let v = validateEconomicCompletionSpeech(clean, facts);
    if (!v.ok) {
      try {
        const retryUser = [
          user,
          "",
          "PRIOR DRAFT FAILED FACT CHECK:",
          clean,
          `reasons: ${v.reasons.join(",")}`,
          "Rewrite preserving trusted facts exactly.",
        ].join("\n");
        const raw2 = await callModel({
          model: STAGE12_JUDGE_OPENAI_MODEL,
          system,
          user: retryUser,
          maxCompletionTokens: Math.min(STAGE12_JUDGE_MAX_COMPLETION_TOKENS, 320),
        });
        clean = sanitizeReplyCandidate(raw2.replyText);
        if (!clean) return fallback(facts, ["retry_sanitize_failed", ...v.reasons]);
        v = validateEconomicCompletionSpeech(clean, facts);
        if (!v.ok) return fallback(facts, v.reasons);
      } catch {
        return fallback(facts, v.reasons);
      }
    }

    return {
      replyText: clean,
      source: "book_of_speech",
      usedFallback: false,
      promptVersion: ECONOMIC_COMPLETION_SPEECH_PROMPT_VERSION,
      validationReasons: [],
    };
  } catch (error) {
    return fallback(facts, [
      error instanceof Error ? error.message : "model_failed",
    ]);
  }
}
