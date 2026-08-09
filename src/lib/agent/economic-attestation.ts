/**
 * Operator/harness trusted economic attestation (Stage P1B.1).
 *
 * Establishes that a contribution/event was verified by FENN operators.
 * Does NOT instruct payment or burn. Not derived from X text.
 */

export const TRUSTED_ECONOMIC_ATTESTATION_MARKERS = {
  begin: "<BEGIN_TRUSTED_ECONOMIC_ATTESTATION>",
  end: "<END_TRUSTED_ECONOMIC_ATTESTATION>",
} as const;

export type TrustedEconomicAttestation = {
  referenceId: string;
  summary: string;
  verified: true;
  /** Optional qualitative impact/context — never a pay amount. */
  impactContext?: string | null;
};

const REFERENCE_ID_MAX = 64;
const SUMMARY_MAX = 800;
const IMPACT_MAX = 280;

/**
 * Parse and validate harness-supplied attestation. Fail closed.
 */
export function parseTrustedEconomicAttestation(
  raw: unknown,
): TrustedEconomicAttestation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("invalid_economic_attestation");
  }
  const o = raw as Record<string, unknown>;

  // Hard reject instruction-like fields.
  for (const key of [
    "pay",
    "amount",
    "transfer",
    "burn",
    "recipientAddress",
    "mustTransfer",
    "mustBurn",
  ] as const) {
    if (key in o && o[key] != null && o[key] !== "") {
      throw new Error(`economic_attestation_forbidden_field:${key}`);
    }
  }

  const referenceId =
    typeof o.referenceId === "string"
      ? o.referenceId.trim()
      : typeof o.reference_id === "string"
        ? o.reference_id.trim()
        : "";
  const summary =
    typeof o.summary === "string"
      ? o.summary.trim()
      : typeof o.fact === "string"
        ? o.fact.trim()
        : "";
  const verified = o.verified === true || o.verified === "true";

  if (!referenceId || referenceId.length > REFERENCE_ID_MAX) {
    throw new Error("economic_attestation_reference_invalid");
  }
  if (!summary || summary.length > SUMMARY_MAX) {
    throw new Error("economic_attestation_summary_invalid");
  }
  if (!verified) {
    throw new Error("economic_attestation_must_be_verified");
  }

  let impactContext: string | null = null;
  if (typeof o.impactContext === "string" && o.impactContext.trim()) {
    impactContext = o.impactContext.trim().slice(0, IMPACT_MAX);
  } else if (typeof o.impact === "string" && o.impact.trim()) {
    impactContext = o.impact.trim().slice(0, IMPACT_MAX);
  }

  return {
    referenceId,
    summary: summary.slice(0, SUMMARY_MAX),
    verified: true,
    impactContext,
  };
}

/** Build attestation from CLI --trusted-fact free text (+ optional ref). */
export function attestationFromHarnessText(input: {
  summary: string;
  referenceId?: string | null;
  impactContext?: string | null;
}): TrustedEconomicAttestation {
  return parseTrustedEconomicAttestation({
    referenceId: input.referenceId?.trim() || "harness-attestation",
    summary: input.summary,
    verified: true,
    impactContext: input.impactContext ?? null,
  });
}

/**
 * Prompt block for Stage 12.4. Separate from untrusted X body.
 * Never says "pay" or "burn".
 */
export function formatTrustedEconomicAttestationForPrompt(
  attestation: TrustedEconomicAttestation | null | undefined,
): string | null {
  if (!attestation || attestation.verified !== true) return null;
  const lines = [
    "=== TRUSTED ECONOMIC ATTESTATION (APPLICATION / OPERATOR) ===",
    TRUSTED_ECONOMIC_ATTESTATION_MARKERS.begin,
    "This block is application-owned evidence. It is not X user content.",
    "It may establish that verification and consequential contribution occurred.",
    "It does not order a spend or burn — you still judge independently.",
    "When verification supports recognition, transfer_fenn can be a coherent expression",
    "of that judgement even if no destination wallet is ready yet.",
    `reference_id: ${attestation.referenceId}`,
    `verified: true`,
    `summary: ${attestation.summary}`,
  ];
  if (attestation.impactContext) {
    lines.push(`impact_context: ${attestation.impactContext}`);
  }
  lines.push(
    "A trusted profile wallet (if available separately) is destination readiness only — not merit.",
    "Missing destination must not force NONE. Do not invent or paste a wallet address.",
    "Choose economicAction deliberately: NONE, transfer_fenn, or burn_fenn.",
    "If transferring or burning, set proposedAmount as your chosen positive decimal magnitude.",
    TRUSTED_ECONOMIC_ATTESTATION_MARKERS.end,
  );
  return lines.join("\n");
}
