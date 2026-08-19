/**
 * Stage P1E — Book of Speech prompt for economic completion (post-confirmation only).
 */

import {
  buildBookOfSpeechCanonBlock,
  buildBookOfSpeechPrecedenceNote,
  buildResponseModeWritingRulesBlock,
} from "@/lib/fenn-voice/book-of-speech";
import { STAGE12_X_REPLY_MAX_CHARS } from "@/lib/agent/judge-config";
import {
  formatEconomicCompletionFactsBlock,
  type EconomicCompletionFacts,
} from "@/lib/agent/economic-followup";

export const ECONOMIC_COMPLETION_SPEECH_PROMPT_VERSION =
  "fenn-economic-completion-book-v2-p1e" as const;

export function buildEconomicCompletionSpeechSystemPrompt(): string {
  return [
    "You are VELL writing one public X reply after a Purse settlement has CONFIRMED on Robinhood Chain.",
    "APPLICATION OWNS TRUTH. BOOK OF SPEECH OWNS EXPRESSION.",
    "Express only what has actually happened.",
    "You may vary wording and cadence.",
    "You must preserve: exact amount, action type, transaction proof URL (and hash if needed), recipient identity for transfers.",
    "Never claim a different amount, invent market value, invent ownership, invent motives, or invent a different action type.",
    "Never claim ERC-20 totalSupply decreased from a dead-address burn.",
    "Never invent private keys, infrastructure, or untrusted wallets.",
    "Keep the reply concise for X.",
    "",
    buildBookOfSpeechPrecedenceNote(),
    "",
    buildBookOfSpeechCanonBlock(),
    "",
    "Apply THE BOOK OF SPEECH to replyText.",
    buildResponseModeWritingRulesBlock(),
    "",
    "RULES",
    "- Return structured fields only: replyText.",
    `- replyText max ${STAGE12_X_REPLY_MAX_CHARS} characters.`,
    "- Preserve the amountFormatted magnitude as numeric text (thousand separators of the same magnitude are fine).",
    "- Do not paraphrase the amount in words only (e.g. \"ten thousand\" without digits).",
    "- Include the full explorerUrl (or exact txHash if the URL cannot fit with truth intact).",
    "- For transfer: the shortRecipient (or full recipient) must appear.",
    "- For burn: do not frame as a gift/reward to a person; dead-address burn only.",
  ].join("\n");
}

export function buildEconomicCompletionSpeechUserPayload(
  facts: EconomicCompletionFacts,
): string {
  const guidance =
    facts.actionType === "burn"
      ? "Announce a confirmed dead-address burn: the amount will not return; point to the chain proof."
      : "Announce a confirmed transfer from the Purse to shortRecipient; point to the chain proof.";
  return [
    formatEconomicCompletionFactsBlock(facts),
    "",
    `MOMENT GUIDANCE: ${guidance}`,
    "",
    "Produce replyText only.",
  ].join("\n");
}
