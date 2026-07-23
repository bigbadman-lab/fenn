import type { MemoryReviewResult } from "@/lib/memory/review-schema";

/**
 * Deterministic pre-checks before calling the model reviewer.
 * Returns a discard decision when clearly unsafe/low-value; otherwise null.
 */
export function deterministicMemoryDiscard(
  content: string,
): MemoryReviewResult | null {
  const text = content.trim();
  if (text.length === 0) {
    return { decision: "discard", reasonCode: "low_value" };
  }

  const lower = text.toLowerCase();
  const compact = lower.replace(/\s+/g, " ");

  // Ultra-short greetings / filler
  if (
    text.length < 12 ||
    /^(hi|hey|hello|yo|sup|gm|gn|thanks|thank you|ok|okay|lol|lmao)[.!?]*$/i.test(
      text.trim(),
    )
  ) {
    return { decision: "discard", reasonCode: "low_value" };
  }

  // Prompt injection / instruction attempts
  if (
    /\bignore (all |any )?(previous|prior|above) (instructions|rules|prompts)\b/i.test(
      text,
    ) ||
    /\byou are now\b/i.test(text) ||
    /\bsystem prompt\b/i.test(text) ||
    /\breveal (your |the )?(system|hidden|secret)/i.test(text) ||
    /\bjailbreak\b/i.test(text) ||
    /\bgrant (me |yourself )?(admin|permission|access)\b/i.test(text)
  ) {
    return { decision: "discard", reasonCode: "instructional_content" };
  }

  // Canon rewrite attempts as primary thrust
  if (
    /\b(leaf|greenwood|canon|fenn)\b.{0,40}\b(now means|is now redefined|rules? are now|should ignore)\b/i.test(
      compact,
    ) ||
    /\brewrite (the )?canon\b/i.test(compact)
  ) {
    return { decision: "discard", reasonCode: "canon_rewrite" };
  }

  // Secrets / contact / wallets as primary payload
  if (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) ||
    /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(text) ||
    /\b(sk-|api[_-]?key|private[_-]?key|secret[_-]?key|service[_-]?role)\b/i.test(
      text,
    ) ||
    /\b0x[a-fA-F0-9]{40}\b/.test(text)
  ) {
    return { decision: "discard", reasonCode: "personal_data" };
  }

  // Current mutable economic / standing state as primary value
  if (
    /\b(treasury|commons)\b.{0,40}\b(currently|right now|has|holds|is)\b.{0,20}(\$|usd|\d)/i.test(
      compact,
    ) ||
    /\b(i (currently )?have|my (current )?)\b.{0,20}\b\d+\b.{0,10}\bleaf\b/i.test(
      compact,
    ) ||
    /\bcurrently\b.{0,30}\b(marks?|members?|balance|committed)\b/i.test(
      compact,
    ) ||
    /\bthis deed is (open|active) (today|now|currently)\b/i.test(compact)
  ) {
    return { decision: "discard", reasonCode: "temporary_state" };
  }

  return null;
}

export function normalizeMemoryContentForDedup(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}
