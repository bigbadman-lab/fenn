/**
 * Focused reply recovery generator for the always-reply guarantee.
 *
 * Runs only when eligible policy requires a reply and no valid replyText exists.
 * Does not rejudge engagement, safety, or Wall decisions.
 * At most one recovery model call per invocation.
 */

import "server-only";

import { zodResponseFormat } from "openai/helpers/zod";

import {
  STAGE12_JUDGE_MAX_COMPLETION_TOKENS,
  STAGE12_JUDGE_OPENAI_MODEL,
} from "@/lib/agent/judge-config";
import {
  isHardBlockReasonCode,
  policyOutcomeFromAction,
  type Stage12PolicyOutcome,
} from "@/lib/agent/reply-guarantee-policy";
import {
  buildReplyRecoverySystemPrompt,
  buildReplyRecoveryUserPayload,
  type ReplyRecoveryPolicyOutcome,
} from "@/lib/agent/reply-recovery-prompt";
import {
  parseReplyRecoveryModelOutput,
  sanitizeReplyCandidate,
  STAGE12_REPLY_RECOVERY_PROMPT_VERSION,
  stage12ReplyRecoveryModelSchema,
  type Stage12ReplyRecoveryModelOutput,
} from "@/lib/agent/reply-recovery-schema";

export type ReplyRecoveryStatus =
  | "not_needed"
  | "attempted"
  | "succeeded"
  | "failed";

export type ReplyRecoveryObservability =
  | "reply_recovery_attempted"
  | "reply_recovery_succeeded"
  | "reply_generation_failed"
  | "reply_pending_retry";

export type ReplyRecoveryModelCaller = (args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}) => Promise<Stage12ReplyRecoveryModelOutput>;

export type ReplyRecoveryInput = {
  xPostId: string;
  perceptionType: string;
  authorXUserId: string;
  authorUsername: string | null;
  body: string;
  /** Selected policy; recovery must not change this. */
  policyOutcome: ReplyRecoveryPolicyOutcome;
  wallBody: string | null;
  knowledgeBoundaryNote?: string | null;
  callModel?: ReplyRecoveryModelCaller;
};

export type ReplyRecoveryResult =
  | {
      ok: true;
      replyText: string;
      status: "succeeded";
      observability: "reply_recovery_succeeded";
      model: string;
      promptVersion: typeof STAGE12_REPLY_RECOVERY_PROMPT_VERSION;
    }
  | {
      ok: false;
      status: "failed";
      observability: "reply_generation_failed";
      error: string;
      model: string;
      promptVersion: typeof STAGE12_REPLY_RECOVERY_PROMPT_VERSION;
    };

/**
 * True when policy requires a reply and the draft is missing/unusable.
 * Hard blocks never need recovery.
 */
export function intentionNeedsReplyRecovery(input: {
  action: string | null | undefined;
  reasonCode?: string | null;
  replyText: string | null | undefined;
}): boolean {
  if (isHardBlockReasonCode(input.reasonCode)) return false;
  if (input.action === "do_nothing") return false;
  if (
    input.action !== "reply_on_x" &&
    input.action !== "reply_and_write_to_wall"
  ) {
    return false;
  }
  return sanitizeReplyCandidate(input.replyText) === null;
}

export function policyOutcomeForRecovery(
  action: string | null | undefined,
  wallBody: string | null | undefined,
): ReplyRecoveryPolicyOutcome {
  if (
    action === "reply_and_write_to_wall" ||
    (wallBody != null && wallBody.length > 0)
  ) {
    return "wall_and_reply";
  }
  return "reply_only";
}

export function mapRecoveryToPolicyOutcomeLabel(
  status: ReplyRecoveryStatus,
  action?: string | null,
): Stage12PolicyOutcome | null {
  if (status === "not_needed") return null;
  if (status === "succeeded") {
    return action ? policyOutcomeFromAction(action) : "reply_only";
  }
  if (status === "attempted" || status === "failed") {
    return "reply_generation_failed";
  }
  return null;
}

function isTimeoutLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; code?: string; name?: string };
  return (
    e.status === 408 ||
    e.code === "timeout" ||
    e.name === "APIConnectionTimeoutError"
  );
}

async function defaultReplyRecoveryModelCaller(args: {
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
      throw new Error("reply recovery model is not configured");
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
        "fenn_public_reply_recovery",
      ),
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new Error("reply recovery model returned no structured result");
    }
    return parseReplyRecoveryModelOutput(parsed);
  } catch (error) {
    if (isTimeoutLike(error)) {
      throw new Error("reply recovery model timed out");
    }
    if (error instanceof Error) throw error;
    throw new Error("reply recovery model failed");
  }
}

/**
 * Generate exactly one FENN reply. Does not rejudge eligibility.
 * Single model attempt — no recursive recovery loops.
 */
export async function runFennReplyRecovery(
  input: ReplyRecoveryInput,
): Promise<ReplyRecoveryResult> {
  const callModel = input.callModel ?? defaultReplyRecoveryModelCaller;
  const system = buildReplyRecoverySystemPrompt();
  const user = buildReplyRecoveryUserPayload({
    xPostId: input.xPostId,
    perceptionType: input.perceptionType,
    authorXUserId: input.authorXUserId,
    authorUsername: input.authorUsername,
    body: input.body,
    policyOutcome: input.policyOutcome,
    wallBody: input.wallBody,
    knowledgeBoundaryNote: input.knowledgeBoundaryNote ?? null,
  });

  try {
    const raw = await callModel({
      model: STAGE12_JUDGE_OPENAI_MODEL,
      system,
      user,
      maxCompletionTokens: Math.min(STAGE12_JUDGE_MAX_COMPLETION_TOKENS, 320),
    });
    const parsed = parseReplyRecoveryModelOutput(raw);
    const clean = sanitizeReplyCandidate(parsed.replyText);
    if (!clean) {
      return {
        ok: false,
        status: "failed",
        observability: "reply_generation_failed",
        error: "recovered replyText failed validation",
        model: STAGE12_JUDGE_OPENAI_MODEL,
        promptVersion: STAGE12_REPLY_RECOVERY_PROMPT_VERSION,
      };
    }
    return {
      ok: true,
      replyText: clean,
      status: "succeeded",
      observability: "reply_recovery_succeeded",
      model: STAGE12_JUDGE_OPENAI_MODEL,
      promptVersion: STAGE12_REPLY_RECOVERY_PROMPT_VERSION,
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      observability: "reply_generation_failed",
      error: error instanceof Error ? error.message : "reply recovery failed",
      model: STAGE12_JUDGE_OPENAI_MODEL,
      promptVersion: STAGE12_REPLY_RECOVERY_PROMPT_VERSION,
    };
  }
}

export type EnsureReplyTextResult =
  | {
      status: "not_needed";
      observability: null;
      replyText: string;
      recoveryCalls: 0;
    }
  | {
      status: "succeeded";
      observability: "reply_recovery_succeeded";
      replyText: string;
      recoveryCalls: 1;
    }
  | {
      status: "failed";
      observability: "reply_generation_failed";
      replyText: null;
      recoveryCalls: 1;
      error: string;
    }
  | {
      status: "skipped";
      observability: null;
      replyText: string | null;
      recoveryCalls: 0;
      error: string;
    };

/**
 * If intention already has usable reply text → not_needed.
 * Else when eligible for recovery, run recovery once.
 */
export async function ensureReplyTextWithRecovery(input: {
  action: string;
  reasonCode?: string | null;
  replyText: string | null;
  wallBody: string | null;
  xPostId: string;
  perceptionType: string;
  authorXUserId: string;
  authorUsername: string | null;
  body: string;
  knowledgeBoundaryNote?: string | null;
  callModel?: ReplyRecoveryModelCaller;
}): Promise<EnsureReplyTextResult> {
  if (
    !intentionNeedsReplyRecovery({
      action: input.action,
      reasonCode: input.reasonCode,
      replyText: input.replyText,
    })
  ) {
    const existing = sanitizeReplyCandidate(input.replyText);
    if (
      existing &&
      (input.action === "reply_on_x" ||
        input.action === "reply_and_write_to_wall")
    ) {
      return {
        status: "not_needed",
        observability: null,
        replyText: existing,
        recoveryCalls: 0,
      };
    }
    // Hard block / deferred silence: no recovery.
    return {
      status: "skipped",
      observability: null,
      replyText: sanitizeReplyCandidate(input.replyText),
      recoveryCalls: 0,
      error: "recovery not applicable for this intention",
    };
  }

  const policyOutcome = policyOutcomeForRecovery(input.action, input.wallBody);
  const recovered = await runFennReplyRecovery({
    xPostId: input.xPostId,
    perceptionType: input.perceptionType,
    authorXUserId: input.authorXUserId,
    authorUsername: input.authorUsername,
    body: input.body,
    policyOutcome,
    wallBody: input.wallBody,
    knowledgeBoundaryNote: input.knowledgeBoundaryNote,
    callModel: input.callModel,
  });

  if (recovered.ok) {
    return {
      status: "succeeded",
      observability: "reply_recovery_succeeded",
      replyText: recovered.replyText,
      recoveryCalls: 1,
    };
  }

  return {
    status: "failed",
    observability: "reply_generation_failed",
    replyText: null,
    recoveryCalls: 1,
    error: recovered.error,
  };
}
