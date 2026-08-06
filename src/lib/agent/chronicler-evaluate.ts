/**
 * Stage 3 — pure Chronicler Wall admission (no I/O).
 */

import type { PublicFactEvidence } from "@/lib/agent/public-fact-evidence";
import type { Stage12ResponseMode } from "@/lib/agent/response-mode";
import {
  type ChroniclerAdmissionResult,
  type WallCandidate,
} from "@/lib/agent/chronicler-types";
import {
  buildChroniclerFingerprint,
  evaluatePublicFactSignificance,
  findTrustedFact,
} from "@/lib/agent/chronicler-significance";
import { normalizeWallCandidate } from "@/lib/agent/wall-candidate-schema";

function emptyObs(
  candidate: WallCandidate | null,
  alreadyRemembered: boolean,
): ChroniclerAdmissionResult["observability"] {
  return {
    kind: candidate?.kind ?? null,
    factKey: candidate?.kind === "public_fact" ? candidate.factKey : null,
    factFingerprint:
      candidate?.kind === "public_fact" ? candidate.factFingerprint : null,
    declarationKey:
      candidate?.kind === "declaration" ? candidate.declarationKey : null,
    reason: candidate?.reason ?? null,
    admitted: false,
    alreadyRemembered,
  };
}

/**
 * Pure evaluator. Caller supplies whether fingerprint already remembered.
 */
export function evaluateChroniclerWallAdmission(input: {
  finalAction: string;
  finalReplyText: string | null;
  finalWallBody: string | null;
  wallCandidate: unknown;
  trustedFacts: readonly PublicFactEvidence[];
  alreadyRemembered: boolean;
  responseMode?: Stage12ResponseMode | null;
}): ChroniclerAdmissionResult {
  const replyOk =
    typeof input.finalReplyText === "string" &&
    input.finalReplyText.trim().length > 0;
  const wallOk =
    typeof input.finalWallBody === "string" &&
    input.finalWallBody.trim().length > 0;

  if (input.finalAction !== "reply_and_write_to_wall") {
    if (input.wallCandidate == null) {
      return {
        decision: "suppress_wall",
        code: "no_candidate",
        candidate: null,
        observability: emptyObs(null, input.alreadyRemembered),
      };
    }
    return {
      decision: "invalid_candidate",
      code: "not_dual_action",
      candidate: null,
      observability: emptyObs(null, input.alreadyRemembered),
    };
  }

  if (!replyOk) {
    return {
      decision: "invalid_candidate",
      code: "missing_reply",
      candidate: null,
      observability: emptyObs(null, input.alreadyRemembered),
    };
  }

  if (!wallOk) {
    return {
      decision: "invalid_candidate",
      code: "missing_wall_body",
      candidate: null,
      observability: emptyObs(null, input.alreadyRemembered),
    };
  }

  if (input.wallCandidate == null) {
    // Dual without structure: suppress Wall (routine dual not admitted).
    return {
      decision: "suppress_wall",
      code: "no_candidate",
      candidate: null,
      observability: emptyObs(null, input.alreadyRemembered),
    };
  }

  const normalized = normalizeWallCandidate({
    raw: input.wallCandidate,
    action: "reply_and_write_to_wall",
    responseMode: input.responseMode,
    trustedFacts: input.trustedFacts,
  });

  if (!normalized) {
    return {
      decision: "invalid_candidate",
      code: "invalid_shape",
      candidate: null,
      observability: emptyObs(null, input.alreadyRemembered),
    };
  }

  if (normalized.kind === "public_fact") {
    const evidence = findTrustedFact(input.trustedFacts, normalized.factKey);
    if (!evidence) {
      return {
        decision: "suppress_wall",
        code: "fact_not_in_evidence",
        candidate: null,
        observability: {
          ...emptyObs(normalized, input.alreadyRemembered),
          factKey: normalized.factKey,
          factFingerprint: normalized.factFingerprint,
        },
      };
    }
    const expected = buildChroniclerFingerprint(evidence);
    if (!expected || expected !== normalized.factFingerprint) {
      return {
        decision: "suppress_wall",
        code: "fingerprint_mismatch",
        candidate: null,
        observability: {
          ...emptyObs(normalized, input.alreadyRemembered),
          factKey: normalized.factKey,
          factFingerprint: normalized.factFingerprint,
        },
      };
    }
    const sig = evaluatePublicFactSignificance(evidence, normalized.reason);
    if (!sig.ok) {
      return {
        decision: "suppress_wall",
        code: "significance_rejected",
        candidate: null,
        observability: {
          ...emptyObs(normalized, input.alreadyRemembered),
          factKey: normalized.factKey,
          factFingerprint: normalized.factFingerprint,
        },
      };
    }
    if (input.alreadyRemembered) {
      return {
        decision: "suppress_wall",
        code: "already_remembered",
        candidate: normalized,
        observability: {
          kind: "public_fact",
          factKey: normalized.factKey,
          factFingerprint: normalized.factFingerprint,
          declarationKey: null,
          reason: sig.reason,
          admitted: false,
          alreadyRemembered: true,
        },
      };
    }
    const admitted: WallCandidate = {
      kind: "public_fact",
      factKey: normalized.factKey,
      factFingerprint: expected,
      reason: sig.reason,
    };
    return {
      decision: "allow_wall",
      code: "admitted",
      candidate: admitted,
      observability: {
        kind: "public_fact",
        factKey: admitted.factKey,
        factFingerprint: admitted.factFingerprint,
        declarationKey: null,
        reason: admitted.reason,
        admitted: true,
        alreadyRemembered: false,
      },
    };
  }

  if (normalized.kind === "declaration") {
    const mode = input.responseMode ?? "canon";
    if (mode !== "creation" && mode !== "canon" && mode !== "judgement") {
      return {
        decision: "suppress_wall",
        code: "response_mode_rejected",
        candidate: null,
        observability: emptyObs(normalized, false),
      };
    }
    // If trustworthy fact counts dominate, refuse declaration disguise.
    if (
      input.responseMode === "fact" &&
      input.trustedFacts.some((f) => f.available)
    ) {
      return {
        decision: "suppress_wall",
        code: "routine_fact_as_declaration",
        candidate: null,
        observability: emptyObs(normalized, false),
      };
    }
    return {
      decision: "allow_wall",
      code: "admitted",
      candidate: normalized,
      observability: {
        kind: "declaration",
        factKey: null,
        factFingerprint: null,
        declarationKey: normalized.declarationKey,
        reason: normalized.reason,
        admitted: true,
        alreadyRemembered: false,
      },
    };
  }

  // historic_exchange
  if (input.responseMode === "fact") {
    return {
      decision: "suppress_wall",
      code: "routine_fact_as_historic",
      candidate: null,
      observability: emptyObs(normalized, false),
    };
  }
  return {
    decision: "allow_wall",
    code: "admitted",
    candidate: normalized,
    observability: {
      kind: "historic_exchange",
      factKey: null,
      factFingerprint: null,
      declarationKey: null,
      reason: normalized.reason,
      admitted: true,
      alreadyRemembered: false,
    },
  };
}
