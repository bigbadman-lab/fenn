/**
 * P2D — trusted live official $FENN fact formatting for calibration / Stage 12.
 * Read path only. Delegates to existing public fact reader + official-token resolver.
 */

import "server-only";

import {
  buildPublicFactEvidencePromptBlock,
  type PublicFactEvidence,
} from "@/lib/agent/public-fact-evidence";
import { readOfficialFennToken } from "@/lib/agent/public-fact-readers";
import {
  extractEvmAddressCandidates,
  verifyCandidateAgainstOfficialContract,
  type OfficialContractVerifyResult,
} from "@/lib/agent/official-token-address-verify";

/**
 * Whether a question needs trusted live official-token state
 * (contract / CA / launch-as-live / address verification).
 */
export function questionNeedsOfficialTokenLiveState(text: string): boolean {
  if (typeof text !== "string") return false;
  const t = text.normalize("NFKC").trim();
  if (!t) return false;

  if (/0x[a-fA-F0-9]{40}/.test(t)) return true;
  if (/\b(what('| i)?s|where is|show|give)\b.{0,40}\b(the\s+)?(fenn\s+)?(ca|contract|token address)\b/i.test(
    t,
  )) {
    return true;
  }
  if (/\b(ca|contract address|token address|official (fenn )?contract)\b/i.test(t)) {
    return true;
  }
  // "has FENN launched?" = live contract state — not provenance "where was X launched"
  if (/\bhas \$?fenn launched\b/i.test(t)) return true;
  if (/\bhave you launched\b/i.test(t)) return true;
  if (/\bis \$?fenn (live|launched)\b/i.test(t)) return true;
  if (/\bare you live\b/i.test(t) && /\bfenn\b/i.test(t)) return true;
  if (/\bis 0x/i.test(t) && /\b(official|fenn|contract)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function officialContractFromTokenFact(
  fact: PublicFactEvidence | null | undefined,
): string | null {
  if (!fact || !fact.available || fact.detail == null) return null;
  const m = /(?:^|;\s*)contract=(0x[a-f0-9]{40})(?:\s*;|$)/i.exec(fact.detail);
  if (!m?.[1]) return null;
  return m[1].toLowerCase();
}

export function formatOfficialTokenLiveContextBlock(
  fact: PublicFactEvidence,
): string {
  const lines = [
    "=== TRUSTED LIVE STATE (official token — calibration/sight) ===",
    "Official $FENN contract identity is live configuration, not Canon.",
    "Never invent a contract address. Never use Purse or Treasury addresses as the token CA.",
  ];

  if (!fact.available) {
    lines.push(
      "official_fenn_token: UNAVAILABLE",
      "status: official public contract is not yet configured in trusted live state",
      "token design in Canon may still be answerable; do not claim a live official CA",
    );
  } else {
    lines.push(
      buildPublicFactEvidencePromptBlock([fact]).trim() ||
        `official_fenn_token: ${fact.detail ?? "available"}`,
    );
  }

  return lines.join("\n");
}

export function buildCandidateVerificationNote(
  question: string,
  fact: PublicFactEvidence,
): string | null {
  const candidates = extractEvmAddressCandidates(question);
  if (candidates.length === 0) return null;

  const official = officialContractFromTokenFact(fact);
  const parts: string[] = ["=== OFFICIAL CONTRACT VERIFICATION (trusted) ==="];

  for (const c of candidates) {
    const r: OfficialContractVerifyResult =
      verifyCandidateAgainstOfficialContract({
        candidateRaw: c,
        officialContract: official,
      });
    if (r.status === "match") {
      parts.push(
        `candidate ${r.candidateNormalized}: MATCH — this IS the trusted official $FENN contract`,
      );
    } else if (r.status === "mismatch") {
      parts.push(
        `candidate ${r.candidateNormalized}: MISMATCH — NOT the trusted official contract (official=${r.officialNormalized})`,
      );
    } else if (r.status === "unavailable") {
      parts.push(
        `candidate ${r.candidateNormalized}: cannot verify — no trusted official address yet`,
      );
    } else {
      parts.push(`candidate failed normalize`);
    }
  }

  return parts.join("\n");
}

export async function loadOfficialTokenLiveContextForCalibration(
  question: string,
  deps?: {
    readToken?: typeof readOfficialFennToken;
  },
): Promise<{
  fact: PublicFactEvidence;
  block: string;
  officialContract: string | null;
}> {
  const read = deps?.readToken ?? readOfficialFennToken;
  const fact = await read();
  let block = formatOfficialTokenLiveContextBlock(fact);
  const verify = buildCandidateVerificationNote(question, fact);
  if (verify) {
    block = `${block}\n\n${verify}`;
  }
  return {
    fact,
    block,
    officialContract: officialContractFromTokenFact(fact),
  };
}
