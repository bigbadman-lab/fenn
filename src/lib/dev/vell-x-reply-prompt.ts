/**
 * Thin compatibility wrapper — local terminal uses VELL-native voice builders.
 */

export {
  buildVellXReplySystemPrompt,
  buildVellXReplyUserPayload,
  VELL_UNTRUSTED_X_MARKERS,
  VELL_X_REPLY_PROMPT_VERSION,
} from "@/lib/vell-voice/x-reply-prompt";

/** @deprecated Prefer VELL_X_REPLY_PROMPT_VERSION — kept for existing imports. */
export { VELL_X_REPLY_PROMPT_VERSION as VELL_DEV_X_REPLY_PROMPT_VERSION } from "@/lib/vell-voice/x-reply-prompt";
