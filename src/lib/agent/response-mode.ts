/**
 * Stage 2 — response mode for X public judgements.
 * Classification lives inside the existing initial judge model call.
 * Guides prompting and live-state selection only.
 *
 * Persistence: responseMode is NOT stored on x_perception_judgements —
 * finalize RPC / columns have no place for it without a migration.
 * Keep in-process on Stage12JudgementIntention; sight re-infers from body
 * when needed for copy-forward safety.
 */

export const STAGE12_RESPONSE_MODES = [
  "fact",
  "canon",
  "creation",
  "judgement",
] as const;

export type Stage12ResponseMode = (typeof STAGE12_RESPONSE_MODES)[number];

export function isStage12ResponseMode(
  value: unknown,
): value is Stage12ResponseMode {
  return (
    typeof value === "string" &&
    (STAGE12_RESPONSE_MODES as readonly string[]).includes(value)
  );
}

/** Fail-closed default when model omits or invents a mode. */
export function normalizeResponseMode(
  value: unknown,
): Stage12ResponseMode {
  if (isStage12ResponseMode(value)) return value;
  return "canon";
}

/**
 * Bounded body heuristics for Stage 12.4 when responseMode was not persisted.
 * Prefer over-triggering fact safety only for approved public fact domains.
 */
export function inferResponseModeFromBody(body: string): Stage12ResponseMode {
  const text = body.trim().toLowerCase();
  if (!text) return "canon";

  // Creation invites
  if (
    /\b(write|propose|invent|name|phrase|imagine|carve|should be called|what law|proverb|poem)\b/.test(
      text,
    )
  ) {
    return "creation";
  }

  // Current / measurable public state
  if (
    /\b(how many|are there many|how much|count|threshold|current|open|active|launched|launch|contract|address|gathering|chronicle|book|token|\$fenn|official)\b/.test(
      text,
    ) ||
    /\boutlaws?\b/.test(text) ||
    /\bleaf\b.*\bgreenwood\b|\bgreenwood\b.*\bleaf\b/.test(text)
  ) {
    // "What is an Outlaw?" is definition, not quantity
    if (
      /\bwhat is\b/.test(text) &&
      !/\bhow many|how much|are there|threshold|contract|gathering|launched\b/.test(
        text,
      )
    ) {
      return "canon";
    }
    return "fact";
  }

  // Personal / philosophical
  if (
    /\b(what matters|will i|do you fear|opinion|feel|believe|remember me|your (view|take))\b/.test(
      text,
    )
  ) {
    return "judgement";
  }

  return "canon";
}
