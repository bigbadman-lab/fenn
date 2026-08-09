/**
 * Shared speech-fact amount matching for P1D.1 wallet speech and P1E completion.
 *
 * APPLICATION OWNS TRUTH: only the locked magnitude is accepted.
 * Harmless display formatting of that same magnitude (commas) is allowed.
 * Uses string/token comparison — never JS float.
 */

/**
 * Whether prose presents the locked amount as a number token.
 * Accepts the frozen decimal string and common thousand-separator forms of the
 * *same* digits (e.g. 10000 ↔ 10,000, decimals 10000.5 ↔ 10,000.5).
 * Does not accept a different magnitude.
 */
export function textPresentsLockedAmount(
  text: string,
  lockedAmount: string,
): boolean {
  const locked = normalizeSpeechAmountToken(lockedAmount);
  if (!locked) return false;
  for (const n of extractSpeechAmountTokens(text)) {
    if (normalizeSpeechAmountToken(n) === locked) return true;
  }
  return false;
}

/** Digit tokens that look like FENN amounts (never floats). */
export function extractSpeechAmountTokens(text: string): string[] {
  return text.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/g) ?? [];
}

/** Comma-strip + trivial trailing .0 strip for magnitude equality. */
export function normalizeSpeechAmountToken(raw: string): string {
  return raw.replace(/,/g, "").trim().replace(/\.0+$/, "");
}

/**
 * True when prose contains a multi-digit amount token whose magnitude differs
 * from the locked amount (and is large enough to matter).
 */
export function textHasForeignSpeechAmount(
  text: string,
  lockedAmount: string,
): boolean {
  const lockedNorm = normalizeSpeechAmountToken(lockedAmount);
  if (!lockedNorm) return false;
  for (const n of extractSpeechAmountTokens(text)) {
    const norm = normalizeSpeechAmountToken(n);
    if (norm === lockedNorm) continue;
    // Allow tiny prose counts (1, 2) beside multi-digit locked amounts
    if (norm.length <= 2 && lockedNorm.length > 2) continue;
    if (norm.length >= 3 || Number(norm) >= 100) {
      return true;
    }
  }
  return false;
}
