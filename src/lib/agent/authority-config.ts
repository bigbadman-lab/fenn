/**
 * Stage 12.5 — deterministic authority / consequence policy.
 * 0 OpenAI. 0 RAG. 0 live reads. No execution.
 *
 * Policy stage12.5-always-reply-recovery-v1:
 * Eligible live X intentions always plan an X reply.
 * Wall never appears without a coupled reply effect.
 * Missing reply drafts are recovered via focused generation before planning.
 * Soft silence / empty effects elevate; recovery failure stays retryable.
 * Desk Wall test may pass allowOperationalWallOnly for infrastructure verification.
 */

export const STAGE125_POLICY_VERSION =
  "stage12.5-always-reply-recovery-v1" as const;

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
  /**
   * Eligible intention still lacks a usable reply after recovery.
   * Operational — must not be persisted as a successful no_action completion
   * when callers enforce recovery; kept for pure policy evaluation diagnostics.
   */
  "reply_generation_failed",
  /**
   * Controlled Stage P1A scaffold only — never produced by live X authority.
   * Plans a single transfer_fenn effect via operator entrypoint.
   */
  "permitted_transfer_p1a",
] as const;

export type Stage125PolicyCode = (typeof STAGE125_POLICY_CODES)[number];

export const STAGE125_EFFECT_TYPES = [
  "reply_on_x",
  "write_to_wall",
  "transfer_fenn",
] as const;

export type Stage125EffectType = (typeof STAGE125_EFFECT_TYPES)[number];

/** Deterministic reply effect identity. */
export function stage12ReplyIdempotencyKey(xPostId: string): string {
  const id = xPostId.trim();
  if (!id) throw new Error("xPostId must be non-empty");
  return `${id}:reply`;
}

/**
 * Stage 12.6 → Purse operation_id bridge.
 * Same effectId always maps to the same operation_id across retries.
 */
export function stage12TransferPurseOperationId(effectId: string): string {
  const id = effectId.trim();
  if (!id) throw new Error("effectId must be non-empty");
  return `stage12:transfer_fenn:${id}`;
}

/**
 * Effect-row idempotency key for controlled P1A transfer tests.
 * Distinct from purse operation_id (which uses durable effect uuid).
 */
export function stage12TransferFennEffectIdempotencyKey(
  operationLabel: string,
): string {
  const label = operationLabel.trim();
  if (!label) throw new Error("operationLabel must be non-empty");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,64}$/.test(label)) {
    throw new Error("operationLabel invalid");
  }
  return `p1a:transfer_fenn:${label}`;
}
