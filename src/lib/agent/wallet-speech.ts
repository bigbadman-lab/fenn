/**
 * Stage P1D.1 — fact-locked Book of Speech writer for wallet collection.
 *
 * Facts are application-owned. Expression uses THE BOOK OF SPEECH.
 * On model failure → deterministic fallback (never silent).
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
  buildWalletSpeechFallback,
  walletSpeechMomentRequiresAmount,
  type WalletSpeechFacts,
} from "@/lib/agent/wallet-speech-facts";
import {
  buildWalletSpeechSystemPrompt,
  buildWalletSpeechUserPayload,
  WALLET_SPEECH_PROMPT_VERSION,
} from "@/lib/agent/wallet-speech-prompt";
import { validateWalletSpeechAgainstFacts } from "@/lib/agent/wallet-speech-validate";

export type WalletSpeechModelCaller = (args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}) => Promise<Stage12ReplyRecoveryModelOutput>;

export type WalletSpeechRenderResult = {
  replyText: string;
  /** book_of_speech = passed validation after model; fallback = deterministic. */
  source: "book_of_speech" | "fallback";
  model: string | null;
  promptVersion: typeof WALLET_SPEECH_PROMPT_VERSION;
  validationReasons: string[];
  usedFallback: boolean;
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

async function defaultWalletSpeechModelCaller(args: {
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
      throw new Error("wallet speech model is not configured");
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
        "fenn_wallet_collection_speech",
      ),
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new Error("wallet speech model returned no structured result");
    }
    return parseReplyRecoveryModelOutput(parsed);
  } catch (error) {
    if (isTimeoutLike(error)) {
      throw new Error("wallet speech model timed out");
    }
    if (error instanceof Error) throw error;
    throw new Error("wallet speech model failed");
  }
}

function fallbackResult(
  facts: WalletSpeechFacts,
  reasons: string[],
): WalletSpeechRenderResult {
  const text = buildWalletSpeechFallback(facts);
  console.info("[p1d1-wallet-speech] fallback_voice", {
    moment: facts.moment,
    settlementState: facts.settlementState,
    reasons,
  });
  return {
    replyText: text,
    source: "fallback",
    model: null,
    promptVersion: WALLET_SPEECH_PROMPT_VERSION,
    validationReasons: reasons,
    usedFallback: true,
  };
}

/**
 * Render one wallet-collection reply under Book of Speech, fact-locked.
 * Never throws for model failure — returns fallback.
 * Never mutates economic/wallet/authority state.
 */
export async function renderWalletCollectionSpeech(input: {
  facts: WalletSpeechFacts;
  untrustedUserBody?: string | null;
  callModel?: WalletSpeechModelCaller;
  /** Force deterministic fallback (tests / offline harness). */
  forceFallback?: boolean;
}): Promise<WalletSpeechRenderResult> {
  const facts = input.facts;

  // Producer fail-closed: amount-required moments with blank amount never pretend model can invent it.
  if (
    walletSpeechMomentRequiresAmount(facts.moment) &&
    !facts.amountFormatted?.trim()
  ) {
    return fallbackResult(facts, ["missing_trusted_amount_in_facts"]);
  }

  if (input.forceFallback) {
    return fallbackResult(facts, ["force_fallback"]);
  }

  const callModel = input.callModel ?? defaultWalletSpeechModelCaller;
  const system = buildWalletSpeechSystemPrompt();
  const user = buildWalletSpeechUserPayload({
    facts,
    untrustedUserBody: input.untrustedUserBody,
  });

  try {
    const raw = await callModel({
      model: STAGE12_JUDGE_OPENAI_MODEL,
      system,
      user,
      maxCompletionTokens: Math.min(STAGE12_JUDGE_MAX_COMPLETION_TOKENS, 320),
    });
    const parsed = parseReplyRecoveryModelOutput(raw);
    let clean = sanitizeReplyCandidate(parsed.replyText);
    if (!clean) {
      return fallbackResult(facts, ["sanitize_failed"]);
    }

    let validation = validateWalletSpeechAgainstFacts(clean, facts);
    if (!validation.ok) {
      // One regeneration attempt with prior draft noted.
      try {
        const retryUser = [
          buildWalletSpeechUserPayload({
            facts,
            untrustedUserBody: input.untrustedUserBody,
          }),
          "",
          "PRIOR DRAFT FAILED FACT CHECK:",
          clean,
          `reasons: ${validation.reasons.join(",")}`,
          "Rewrite replyText preserving trusted facts exactly.",
        ].join("\n");
        const raw2 = await callModel({
          model: STAGE12_JUDGE_OPENAI_MODEL,
          system,
          user: retryUser,
          maxCompletionTokens: Math.min(STAGE12_JUDGE_MAX_COMPLETION_TOKENS, 320),
        });
        const parsed2 = parseReplyRecoveryModelOutput(raw2);
        clean = sanitizeReplyCandidate(parsed2.replyText);
        if (!clean) {
          return fallbackResult(facts, ["retry_sanitize_failed", ...validation.reasons]);
        }
        validation = validateWalletSpeechAgainstFacts(clean, facts);
        if (!validation.ok) {
          return fallbackResult(facts, validation.reasons);
        }
      } catch {
        return fallbackResult(facts, validation.reasons);
      }
    }

    return {
      replyText: clean,
      source: "book_of_speech",
      model: STAGE12_JUDGE_OPENAI_MODEL,
      promptVersion: WALLET_SPEECH_PROMPT_VERSION,
      validationReasons: [],
      usedFallback: false,
    };
  } catch (error) {
    return fallbackResult(facts, [
      error instanceof Error ? error.message : "model_failed",
    ]);
  }
}

/** Pure sync path for unit tests / harness without model. */
export function renderWalletCollectionSpeechFallback(
  facts: WalletSpeechFacts,
): WalletSpeechRenderResult {
  return fallbackResult(facts, ["sync_fallback"]);
}
