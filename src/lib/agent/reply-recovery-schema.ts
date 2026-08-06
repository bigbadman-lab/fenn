/**
 * Stage 12 reply recovery — narrow structured output schema.
 * Reply text only. No action, engage, wall, or safety decision.
 */

import { z } from "zod";

import { STAGE12_X_REPLY_MAX_CHARS } from "@/lib/agent/judge-config";

export const STAGE12_REPLY_RECOVERY_PROMPT_VERSION =
  "fenn-public-reply-recovery-book-v2" as const;

export const stage12ReplyRecoveryModelSchema = z.object({
  replyText: z.string().min(1).max(STAGE12_X_REPLY_MAX_CHARS),
});

export type Stage12ReplyRecoveryModelOutput = z.infer<
  typeof stage12ReplyRecoveryModelSchema
>;

/** Parse + trim defence for recovery model output. */
export function parseReplyRecoveryModelOutput(
  value: unknown,
): Stage12ReplyRecoveryModelOutput {
  const parsed = stage12ReplyRecoveryModelSchema.parse(value);
  const trimmed = parsed.replyText.trim();
  if (trimmed.length === 0) {
    throw new Error("reply recovery returned empty replyText");
  }
  if (trimmed.length > STAGE12_X_REPLY_MAX_CHARS) {
    throw new Error("reply recovery replyText exceeds max length");
  }
  return { replyText: trimmed };
}

/**
 * Sanitise a candidate string for use as an X reply (no model call).
 * Returns null when unusable.
 */
export function sanitizeReplyCandidate(
  text: string | null | undefined,
): string | null {
  if (text == null) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > STAGE12_X_REPLY_MAX_CHARS) {
    return trimmed.slice(0, STAGE12_X_REPLY_MAX_CHARS);
  }
  // Reject dangerous C0 controls (same policy as authority).
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code === 127) return null;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return null;
  }
  return trimmed;
}
