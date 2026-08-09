/**
 * P2D — pure verification of candidate addresses against trusted live official $FENN.
 * Does not read DB by itself; callers supply official address or null (unavailable).
 */

import {
  isNormalizedEvmAddress,
  parseEvmAddress,
} from "@/lib/wallet/evm";

export type OfficialContractVerifyStatus =
  | "match"
  | "mismatch"
  | "unavailable"
  | "invalid_candidate";

export type OfficialContractVerifyResult = {
  status: OfficialContractVerifyStatus;
  candidateNormalized: string | null;
  officialNormalized: string | null;
};

/**
 * Compare a user-supplied candidate to trusted official contract.
 * Official must already be normalized; null/empty = no trusted official yet.
 */
export function verifyCandidateAgainstOfficialContract(input: {
  candidateRaw: string;
  /** Trusted live official address, or null when unresolved. */
  officialContract: string | null | undefined;
}): OfficialContractVerifyResult {
  let candidateNormalized: string | null = null;
  try {
    candidateNormalized = parseEvmAddress(input.candidateRaw);
  } catch {
    return {
      status: "invalid_candidate",
      candidateNormalized: null,
      officialNormalized: null,
    };
  }

  const officialRaw =
    input.officialContract == null
      ? null
      : String(input.officialContract).trim();
  if (officialRaw == null || officialRaw === "") {
    return {
      status: "unavailable",
      candidateNormalized,
      officialNormalized: null,
    };
  }

  let officialNormalized: string;
  try {
    officialNormalized = parseEvmAddress(officialRaw);
  } catch {
    // Misconfigured live state should not bless the candidate
    return {
      status: "unavailable",
      candidateNormalized,
      officialNormalized: null,
    };
  }

  if (!isNormalizedEvmAddress(officialNormalized)) {
    return {
      status: "unavailable",
      candidateNormalized,
      officialNormalized: null,
    };
  }

  if (candidateNormalized === officialNormalized) {
    return {
      status: "match",
      candidateNormalized,
      officialNormalized,
    };
  }

  return {
    status: "mismatch",
    candidateNormalized,
    officialNormalized,
  };
}

/** Operator / test: extract 0x addresses from free text (max few). */
export function extractEvmAddressCandidates(text: string): string[] {
  if (typeof text !== "string") return [];
  const matches = text.match(/0x[a-fA-F0-9]{40}/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    try {
      const n = parseEvmAddress(m);
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    } catch {
      // skip invalid hex patterns that fail normalize edge cases
    }
  }
  return out;
}
