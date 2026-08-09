/**
 * Stage 12.3 — detect legitimate self-knowledge / economic-boundary conversation.
 *
 * Used only to prevent mis-labelled spam_or_noise hard blocks when public
 * knowledge can answer FENN's own capabilities and limits.
 * Does not invent economic actions or amounts.
 */

/**
 * True when untrusted body reads as a question or request about FENN's identity,
 * capabilities, Purse/Treasury, transfer/burn, wallet trust, authority, or settlement.
 *
 * Deliberately narrow: not every mention of "FENN" or "token".
 * True spam (ticker spam, incoherent noise) should remain hard-blockable.
 */
export function isSelfKnowledgeOrEconomicBoundaryConversation(
  body: string,
): boolean {
  if (typeof body !== "string") return false;
  const t = body.normalize("NFKC").trim();
  if (t.length < 3 || t.length > 800) return false;

  // Capability / identity questions
  if (
    /\bwhat can you do\b/i.test(t) ||
    /\bwho are you\b/i.test(t) ||
    /\bwhat are you\b/i.test(t) ||
    /\bwhat (is|are) (your|the) (purse|treasury)\b/i.test(t) ||
    /\bis the purse (the )?treasury\b/i.test(t) ||
    /\bcan (you|authority)\b.+\b(send|transfer|burn|move|stop|refuse|spend)\b/i.test(
      t,
    ) ||
    /\bcan you (send|transfer|burn|move|give)\b/i.test(t) ||
    /\bcould you (send|transfer|burn|move|give)\b/i.test(t) ||
    /\bhow do you know where to send\b/i.test(t) ||
    /\bwhen is (a |the )?transfer (actually )?complete\b/i.test(t) ||
    /\bremember (it |my wallet )?forever\b/i.test(t) ||
    /\bpermanent (identity|wallet)\b/i.test(t) ||
    // P2D — token identity / LEAF / PONS / CA (still speech-only at 12.3)
    /\bwhat is \$?fenn\b/i.test(t) ||
    /\bwhat is your token\b/i.test(t) ||
    /\bhow many fenn (exist|are there)\b/i.test(t) ||
    /\bhow many decimals\b/i.test(t) ||
    /\bwhat chain is fenn\b/i.test(t) ||
    /\bis leaf\b/i.test(t) ||
    /\bleaf (the same|on-chain|for fenn)\b/i.test(t) ||
    /\b(pons|launchpad)\b/i.test(t) ||
    /\bwhere was fenn launched\b/i.test(t) ||
    /\b(did you|how did you) (launch|deploy)\b/i.test(t) ||
    /\b(what is|what'?s) (the )?(fenn )?(ca|contract)\b/i.test(t) ||
    /\bhas fenn launched\b/i.test(t) ||
    /\bofficial (fenn )?contract\b/i.test(t)
  ) {
    return true;
  }

  // Direct token/economy requests about FENN (still speech-only at 12.3)
  if (
    /\b(send|transfer|give)\s+me\b/i.test(t) &&
    (/\bfenn\b/i.test(t) || /\$fenn\b/i.test(t) || /\d[\d,]*(?:\.\d+)?/.test(t))
  ) {
    return true;
  }

  // Explicit burn / treasury / purse / authority / settlement phrasing
  if (
    (/\b(burn|purse|treasury|settlement|authority)\b/i.test(t) &&
      /\b(fenn|can you|could you|do you|will you|what is|is the)\b/i.test(t)) ||
    /\b(wallet).{0,40}\b(forever|permanent|identity|remember)\b/i.test(t) ||
    /\b(remember).{0,40}\b(wallet)\b/i.test(t)
  ) {
    return true;
  }

  return false;
}

/**
 * Heuristic factual-modality checks for self-knowledge calibration.
 * Not for production gating of every reply — operator/test assertions only.
 */

/** False absolute: "I cannot send FENN" style when agency transfer capability exists. */
export function replyAssertsHardCannotSendFenn(text: string): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  const t = text.toLowerCase();
  return (
    /\b(i\s+)?(cannot|can'?t|can not|unable to|not able to)\s+(send|transfer)(\s+you)?(\s+any)?(\s+fenn|\s+\$?fenn)?\b/.test(
      t,
    ) ||
    /\b(cannot|can'?t|unable to)\s+(initiate|perform).{0,40}(send|transfer).{0,20}fenn\b/.test(
      t,
    ) ||
    /\bfenn (cannot|can'?t|is unable to)\s+(be\s+)?(sent|transferred)\b/.test(t)
  );
}

/** False absolute incapability for burn. */
export function replyAssertsHardCannotBurnFenn(text: string): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  const t = text.toLowerCase();
  return (
    /\b(i\s+)?(cannot|can'?t|can not|unable to)\s+burn(\s+fenn|\s+\$?fenn)?\b/.test(
      t,
    ) || /\bfenn (cannot|can'?t)\s+(be\s+)?burned\b/.test(t)
  );
}

/** Healthy / expected for Treasury questions. */
export function replyDeniesArbitraryTreasuryMove(text: string): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  const t = text.toLowerCase();
  return (
    /\b(cannot|can'?t|do not|don't|not)\b.{0,40}\b(move|control|spend|freely).{0,30}\btreasury\b/.test(
      t,
    ) ||
    /\btreasury\b.{0,50}\b(not (mine|freely|under my free)|outside|beyond|not under)/.test(
      t,
    ) ||
    /\b(does not|don't|do not)\s+(freely\s+)?(move|control)\s+the\s+treasury\b/.test(
      t,
    )
  );
}

/**
 * Demand lines: treat requested figure as if it were an authorised transfer amount.
 * Soft "asking does not set" is fine; "100000 will be sent" is not.
 */
export function replyTreatsUserRequestedAmountAsAuthoritative(
  text: string,
  requestedFigure: string,
): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  const digits = requestedFigure.replace(/[^\d.]/g, "");
  if (!digits) return false;
  const figure = digits.replace(/\.0+$/, "");
  const t = text.toLowerCase();
  const figRe = new RegExp(
    String.raw`\b(sending|will send|shall send|transferring)\b[^.]{0,50}\b${figure}\b`,
    "i",
  );
  return figRe.test(t) && !/\b(not|never|won't|cannot|can'?t|do not|don't)\b/i.test(
    t,
  );
}

/**
 * Absolute "that amount cannot / will never be sent" as universal impossibility
 * solely from the demand (vs capacity/authority leave room).
 */
export function replyAssertsRequestedAmountCategoricallyImpossible(
  text: string,
): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  const t = text.toLowerCase();
  return (
    /\b(that|this|the)\s+(amount|figure|number)\s+(cannot|can'?t|will never|is impossible)/i.test(
      t,
    ) ||
    /\bthat amount cannot be sent\b/i.test(t) ||
    /\bimpossible to (send|transfer)\b/i.test(t)
  );
}
