/**
 * Stage 3 — Chronicler types: structured Wall candidates and admission results.
 * Models propose; deterministic code admits. No SQL / provenance from models.
 */

export const CHRONICLER_REASONS = [
  "first_observation",
  "milestone_reached",
  "meaningful_state_change",
  "constitutional_declaration",
  "exceptional_exchange",
] as const;

export type ChroniclerReason = (typeof CHRONICLER_REASONS)[number];

/** Facts that may produce durable cross-post Wall memory. */
export const CHRONICLER_FACT_KEYS = [
  "confirmed_outlaw_count",
  "greenwood_member_count",
  "greenwood_leaf_threshold",
  "official_fenn_token",
  "current_public_gathering",
] as const;

export type ChroniclerFactKey = (typeof CHRONICLER_FACT_KEYS)[number];

export function isChroniclerFactKey(value: unknown): value is ChroniclerFactKey {
  return (
    typeof value === "string" &&
    (CHRONICLER_FACT_KEYS as readonly string[]).includes(value)
  );
}

export function isChroniclerReason(value: unknown): value is ChroniclerReason {
  return (
    typeof value === "string" &&
    (CHRONICLER_REASONS as readonly string[]).includes(value)
  );
}

export type WallCandidatePublicFact = {
  kind: "public_fact";
  factKey: ChroniclerFactKey;
  factFingerprint: string;
  reason: ChroniclerReason;
};

export type WallCandidateDeclaration = {
  kind: "declaration";
  declarationKey: string;
  reason: ChroniclerReason;
};

export type WallCandidateHistoricExchange = {
  kind: "historic_exchange";
  reason: ChroniclerReason;
};

export type WallCandidate =
  | WallCandidatePublicFact
  | WallCandidateDeclaration
  | WallCandidateHistoricExchange;

export const CHRONICLER_ADMISSION_DECISIONS = [
  "allow_wall",
  "suppress_wall",
  "invalid_candidate",
] as const;

export type ChroniclerAdmissionDecision =
  (typeof CHRONICLER_ADMISSION_DECISIONS)[number];

export const CHRONICLER_ADMISSION_CODES = [
  "admitted",
  "no_candidate",
  "not_dual_action",
  "missing_reply",
  "missing_wall_body",
  "invalid_shape",
  "disallowed_reason",
  "disallowed_fact_key",
  "fact_not_in_evidence",
  "fingerprint_mismatch",
  "significance_rejected",
  "already_remembered",
  "response_mode_rejected",
  "routine_fact_as_declaration",
  "routine_fact_as_historic",
] as const;

export type ChroniclerAdmissionCode =
  (typeof CHRONICLER_ADMISSION_CODES)[number];

export type ChroniclerAdmissionResult = {
  decision: ChroniclerAdmissionDecision;
  code: ChroniclerAdmissionCode;
  /** Normalized candidate when still relevant for reserve/plan. */
  candidate: WallCandidate | null;
  observability: {
    kind: WallCandidate["kind"] | null;
    factKey: string | null;
    factFingerprint: string | null;
    declarationKey: string | null;
    reason: ChroniclerReason | null;
    admitted: boolean;
    alreadyRemembered: boolean;
  };
};
