import "server-only";

import { zodResponseFormat } from "openai/helpers/zod";

import {
  SPEAKS_TRANSFORM_MAX_COMPLETION_TOKENS,
  SPEAKS_TRANSFORM_OPENAI_MODEL,
  buildSpeaksTransformSystemPrompt,
  buildSpeaksTransformUserPayload,
  normalizeTransformedSpeaksMessage,
  speaksTransformModelSchema,
} from "@/lib/desk/speaks-transform-prompt";
import {
  GREENWOOD_FIRE_MESSAGE_MAX_CHARS,
  validateFireMessageBodyInput,
} from "@/lib/greenwood/fire-message";

export type SpeaksTransformErrorCode =
  | "speaks_transform_invalid"
  | "speaks_transform_unavailable"
  | "speaks_transform_failed";

export class SpeaksTransformError extends Error {
  readonly code: SpeaksTransformErrorCode;
  readonly status: number;

  constructor(code: SpeaksTransformErrorCode, message: string, status: number) {
    super(message);
    this.name = "SpeaksTransformError";
    this.code = code;
    this.status = status;
  }
}

export type SpeaksTransformModelCaller = (args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}) => Promise<{ transformedMessage: string }>;

async function defaultCaller(args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}): Promise<{ transformedMessage: string }> {
  const { getOpenAIClient, OpenAIUnavailableError } = await import(
    "@/lib/ai/openai"
  );
  let client;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof OpenAIUnavailableError) {
      throw new SpeaksTransformError(
        "speaks_transform_unavailable",
        "FENN could not shape these words.",
        503,
      );
    }
    throw error;
  }

  const completion = await client.chat.completions.parse({
    model: args.model,
    max_completion_tokens: args.maxCompletionTokens,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    response_format: zodResponseFormat(
      speaksTransformModelSchema,
      "fenn_speaks_transform",
    ),
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed?.transformedMessage) {
    throw new SpeaksTransformError(
      "speaks_transform_failed",
      "FENN could not shape these words.",
      502,
    );
  }
  return { transformedMessage: parsed.transformedMessage };
}

/**
 * Reshape plain Keeper text into FENN SPEAKS voice.
 * Pure transform — never reads or writes the Speaks database.
 */
export async function transformSpeakMessage(
  rawMessage: string,
  options?: { caller?: SpeaksTransformModelCaller },
): Promise<{ transformedMessage: string }> {
  const validated = validateFireMessageBodyInput(rawMessage);
  if (!validated.ok) {
    throw new SpeaksTransformError(
      "speaks_transform_invalid",
      validated.reason === "too_long"
        ? `Message must be at most ${GREENWOOD_FIRE_MESSAGE_MAX_CHARS} characters`
        : "Message cannot be empty",
      400,
    );
  }

  const caller = options?.caller ?? defaultCaller;
  let modelResult: { transformedMessage: string };
  try {
    modelResult = await caller({
      model: SPEAKS_TRANSFORM_OPENAI_MODEL,
      system: buildSpeaksTransformSystemPrompt(),
      user: buildSpeaksTransformUserPayload(validated.body),
      maxCompletionTokens: SPEAKS_TRANSFORM_MAX_COMPLETION_TOKENS,
    });
  } catch (error) {
    if (error instanceof SpeaksTransformError) throw error;
    console.error("[speaks-transform] model failure", {
      name: error instanceof Error ? error.name : "unknown",
    });
    throw new SpeaksTransformError(
      "speaks_transform_failed",
      "FENN could not shape these words.",
      502,
    );
  }

  const normalized = normalizeTransformedSpeaksMessage(
    modelResult.transformedMessage,
  );
  if (!normalized.ok) {
    throw new SpeaksTransformError(
      "speaks_transform_failed",
      "FENN could not shape these words.",
      502,
    );
  }

  // Re-validate against the same publish body rules.
  const publishable = validateFireMessageBodyInput(normalized.message);
  if (!publishable.ok) {
    throw new SpeaksTransformError(
      "speaks_transform_failed",
      "FENN could not shape these words.",
      502,
    );
  }

  return { transformedMessage: publishable.body };
}

/** Keeper-facing error text for Desk (never provider internals). */
export function deskFacingSpeaksTransformError(
  error: SpeaksTransformError,
): string {
  switch (error.code) {
    case "speaks_transform_invalid":
      return error.message;
    case "speaks_transform_unavailable":
    case "speaks_transform_failed":
      return "FENN could not shape these words.";
    default:
      return "The words remain yours. Try again.";
  }
}
