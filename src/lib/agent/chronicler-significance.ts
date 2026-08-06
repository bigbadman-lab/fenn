/**
 * Stage 3 — deterministic fingerprints and significance for Chronicler public facts.
 * Model never invents fingerprints; application builds them from trusted evidence.
 */

import type { PublicFactEvidence } from "@/lib/agent/public-fact-evidence";
import type {
  ChroniclerFactKey,
  ChroniclerReason,
} from "@/lib/agent/chronicler-types";
import { isChroniclerFactKey } from "@/lib/agent/chronicler-types";

export const OUTLAW_COUNT_MILESTONES = [
  1, 2, 3, 5, 10, 20, 30, 50, 100,
] as const;

export const GREENWOOD_MEMBER_MILESTONES = [
  1, 3, 5, 10, 20, 30, 50, 100,
] as const;

/** Build canonical fingerprint from trusted evidence; null if unavailable. */
export function buildChroniclerFingerprint(
  evidence: PublicFactEvidence,
): string | null {
  if (!evidence.available) return null;
  if (!isChroniclerFactKey(evidence.key)) return null;

  switch (evidence.key) {
    case "confirmed_outlaw_count":
    case "greenwood_member_count":
    case "greenwood_leaf_threshold": {
      if (typeof evidence.value !== "number" || !Number.isInteger(evidence.value)) {
        return null;
      }
      if (evidence.value < 0) return null;
      return `${evidence.key}:v=${evidence.value}`;
    }
    case "official_fenn_token": {
      if (evidence.value !== true) return null;
      const contract = extractContractFromDetail(evidence.detail ?? null);
      if (!contract) return null;
      return `${evidence.key}:contract=${contract}`;
    }
    case "current_public_gathering": {
      if (evidence.value !== true) return null;
      const identity = extractGatheringIdentity(evidence.detail ?? null);
      if (!identity) return null;
      return `${evidence.key}:id=${identity}`;
    }
    default:
      return null;
  }
}

function extractContractFromDetail(detail: string | null): string | null {
  if (!detail) return null;
  const m = detail.match(/contract=(0x[a-fA-F0-9]{40})/);
  return m ? m[1]!.toLowerCase() : null;
}

function extractGatheringIdentity(detail: string | null): string | null {
  if (!detail) return null;
  const starts = detail.match(/starts_at=([^;]+)/)?.[1]?.trim();
  const ends = detail.match(/ends_at=([^;]+)/)?.[1]?.trim();
  if (starts && ends) return `${starts}|${ends}`;
  return null;
}

export type SignificanceResult =
  | { ok: true; reason: ChroniclerReason }
  | { ok: false };

/**
 * Whether a public fact value is significant enough for the Wall.
 * Already-remembered fingerprints are handled by the evaluator separately.
 */
export function evaluatePublicFactSignificance(
  evidence: PublicFactEvidence,
  proposedReason: ChroniclerReason,
): SignificanceResult {
  if (!evidence.available || !isChroniclerFactKey(evidence.key)) {
    return { ok: false };
  }

  const fingerprint = buildChroniclerFingerprint(evidence);
  if (!fingerprint) return { ok: false };

  switch (evidence.key) {
    case "confirmed_outlaw_count": {
      if (typeof evidence.value !== "number") return { ok: false };
      const n = evidence.value;
      if (n <= 0) return { ok: false };
      if (
        (OUTLAW_COUNT_MILESTONES as readonly number[]).includes(n) ||
        n === 1
      ) {
        // First positive observation or listed milestone.
        if (n === 1) {
          return {
            ok: true,
            reason:
              proposedReason === "first_observation"
                ? "first_observation"
                : "milestone_reached",
          };
        }
        return { ok: true, reason: "milestone_reached" };
      }
      return { ok: false };
    }
    case "greenwood_member_count": {
      if (typeof evidence.value !== "number") return { ok: false };
      const n = evidence.value;
      if (n <= 0) return { ok: false };
      if (n === 1) {
        return { ok: true, reason: "first_observation" };
      }
      if ((GREENWOOD_MEMBER_MILESTONES as readonly number[]).includes(n)) {
        return { ok: true, reason: "milestone_reached" };
      }
      return { ok: false };
    }
    case "greenwood_leaf_threshold": {
      // Eligible only if a concrete threshold is observed; first/change vs last
      // remembered fingerprint is checked via already_remembered. Any new
      // fingerprint value is a meaningful_state_change.
      if (typeof evidence.value !== "number") return { ok: false };
      return { ok: true, reason: "meaningful_state_change" };
    }
    case "official_fenn_token": {
      if (evidence.value !== true) return { ok: false };
      return { ok: true, reason: "first_observation" };
    }
    case "current_public_gathering": {
      if (evidence.value !== true) return { ok: false };
      return { ok: true, reason: "meaningful_state_change" };
    }
    default:
      return { ok: false };
  }
}

/** Find evidence matching fact key (available only). */
export function findTrustedFact(
  facts: readonly PublicFactEvidence[],
  key: ChroniclerFactKey,
): PublicFactEvidence | null {
  return facts.find((f) => f.key === key && f.available) ?? null;
}

/** List fingerprints currently buildable from evidence (for prompt hints). */
export function listTrustedFingerprints(
  facts: readonly PublicFactEvidence[],
): Array<{ factKey: ChroniclerFactKey; factFingerprint: string }> {
  const out: Array<{ factKey: ChroniclerFactKey; factFingerprint: string }> =
    [];
  for (const f of facts) {
    if (!isChroniclerFactKey(f.key)) continue;
    const fp = buildChroniclerFingerprint(f);
    if (fp) out.push({ factKey: f.key, factFingerprint: fp });
  }
  return out;
}
