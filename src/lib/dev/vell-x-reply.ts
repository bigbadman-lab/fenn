/**
 * Local-only VELL X reply generator.
 * Paste → Book of Speech voice → one replyText. No X API, no Supabase, no Stage 12.
 */

import "server-only";

import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

import {
  STAGE12_JUDGE_MAX_COMPLETION_TOKENS,
  STAGE12_JUDGE_OPENAI_MODEL,
  STAGE12_X_REPLY_MAX_CHARS,
} from "@/lib/agent/judge-config";
import {
  sanitizeReplyCandidate,
  stage12ReplyRecoveryModelSchema,
} from "@/lib/agent/reply-recovery-schema";
import {
  buildVellXReplySystemPrompt,
  buildVellXReplyUserPayload,
  VELL_X_REPLY_PROMPT_VERSION,
} from "@/lib/dev/vell-x-reply-prompt";

/** Hard cap on pasted inbound text (characters). */
export const VELL_DEV_X_REPLY_BODY_MAX_CHARS = 8_000;

export const VELL_DEV_X_REPLY_USERNAME_MAX_CHARS = 64;

export class VellXReplyError extends Error {
  readonly code:
    | "vell_x_reply_invalid"
    | "vell_x_reply_unavailable"
    | "vell_x_reply_failed";
  readonly status: number;

  constructor(
    code: VellXReplyError["code"],
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "VellXReplyError";
    this.code = code;
    this.status = status;
  }
}

const requestSchema = z
  .object({
    body: z.string().max(VELL_DEV_X_REPLY_BODY_MAX_CHARS),
    username: z.string().max(VELL_DEV_X_REPLY_USERNAME_MAX_CHARS).optional(),
  })
  .strict();

export type VellXReplyRequest = {
  body: string;
  username: string | null;
};

export type VellXReplyModelCaller = (args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}) => Promise<{ replyText: string }>;

export function parseVellXReplyRequest(input: unknown): VellXReplyRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    throw new VellXReplyError(
      "vell_x_reply_invalid",
      "Invalid request.",
      400,
    );
  }

  const body = parsed.data.body.trim();
  if (body.length === 0) {
    throw new VellXReplyError(
      "vell_x_reply_invalid",
      "Incoming text is required.",
      400,
    );
  }

  const rawUsername = parsed.data.username?.trim() ?? "";
  const username =
    rawUsername.length === 0
      ? null
      : rawUsername.replace(/^@+/, "").slice(0, VELL_DEV_X_REPLY_USERNAME_MAX_CHARS);

  return {
    body,
    username: username && username.length > 0 ? username : null,
  };
}

async function defaultCaller(args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}): Promise<{ replyText: string }> {
  const { getOpenAIClient, OpenAIUnavailableError } = await import(
    "@/lib/ai/openai"
  );
  let client;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof OpenAIUnavailableError) {
      throw new VellXReplyError(
        "vell_x_reply_unavailable",
        "OpenAI is not configured.",
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
      stage12ReplyRecoveryModelSchema,
      "vell_dev_x_reply",
    ),
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed?.replyText) {
    throw new VellXReplyError(
      "vell_x_reply_failed",
      "Model returned no replyText.",
      502,
    );
  }
  return { replyText: parsed.replyText };
}

export type GenerateVellXReplyResult = {
  replyText: string;
  model: string;
  promptVersion: typeof VELL_X_REPLY_PROMPT_VERSION;
  maxChars: typeof STAGE12_X_REPLY_MAX_CHARS;
};

/**
 * Generate one VELL-voice X reply from pasted inbound text.
 * Caller must have already passed assertDevOnly().
 */
export async function generateVellXReply(
  request: VellXReplyRequest,
  options?: { callModel?: VellXReplyModelCaller },
): Promise<GenerateVellXReplyResult> {
  const callModel = options?.callModel ?? defaultCaller;
  const system = buildVellXReplySystemPrompt();
  const user = buildVellXReplyUserPayload({
    body: request.body,
    username: request.username,
  });

  let raw: { replyText: string };
  try {
    raw = await callModel({
      model: STAGE12_JUDGE_OPENAI_MODEL,
      system,
      user,
      maxCompletionTokens: Math.min(STAGE12_JUDGE_MAX_COMPLETION_TOKENS, 320),
    });
  } catch (error) {
    if (error instanceof VellXReplyError) throw error;
    throw new VellXReplyError(
      "vell_x_reply_failed",
      error instanceof Error ? error.message : "Reply generation failed.",
      502,
    );
  }

  const clean = sanitizeReplyCandidate(raw.replyText);
  if (!clean) {
    throw new VellXReplyError(
      "vell_x_reply_failed",
      "Generated reply was empty or invalid.",
      502,
    );
  }

  return {
    replyText: clean,
    model: STAGE12_JUDGE_OPENAI_MODEL,
    promptVersion: VELL_X_REPLY_PROMPT_VERSION,
    maxChars: STAGE12_X_REPLY_MAX_CHARS,
  };
}
