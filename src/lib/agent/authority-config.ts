/**
 * Stage 12.5 — deterministic authority / consequence policy.
 * 0 OpenAI. 0 RAG. 0 live reads. No execution.
 *
 * Policy stage12.5-wall-requires-reply-v1:
 * Live X intentions never authorise wall-only consequences.
 * Desk Wall test may pass allowOperationalWallOnly for infrastructure verification.
 */

export const STAGE125_POLICY_VERSION =
  "stage12.5-wall-requires-reply-v1" as const;

export const STAGE125_AUTHORITY_BATCH_DEFAULT = 5;
export const STAGE125_AUTHORITY_BATCH_MAX = 20;

export const STAGE125_AUTHORITY_OUTCOMES = [
  "permitted",
  "denied",
  "no_action",
] as const;

export type Stage125AuthorityOutcome =
  (typeof STAGE125_AUTHORITY_OUTCOMES)[number];

export const STAGE125_POLICY_CODES = [
  "permitted_reply",
  "permitted_wall",
  "permitted_reply_and_wall",
  "no_action",
  "invalid_final_judgement",
  "missing_reply_candidate",
  "missing_wall_candidate",
  "invalid_candidate",
  "event_not_eligible",
  "already_authorised",
  "judgement_failed",
  /** Live X wall-only intentions are refused; dual or Desk ops required. */
  "wall_requires_reply",
] as const;

export type Stage125PolicyCode = (typeof STAGE125_POLICY_CODES)[number];

export const STAGE125_EFFECT_TYPES = ["reply_on_x", "write_to_wall"] as const;

export type Stage125EffectType = (typeof STAGE125_EFFECT_TYPES)[number];

/** Deterministic reply effect identity. */
export function stage12ReplyIdempotencyKey(xPostId: string): string {
  const id = xPostId.trim();
  if (!id) throw new Error("xPostId must be non-empty");
  return `${id}:reply`;
}
