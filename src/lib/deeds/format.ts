import type {
  DeedAccessScope,
  DeedEvidenceRequirements,
  DeedReward,
  EvidenceField,
} from "@/lib/deeds/types";

const MONTHS_UTC = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

const EVIDENCE_ORDER: EvidenceField[] = ["text", "url", "image", "other"];

/** Visual board index only — not a persistent Deed id. */
export function formatBoardIndex(zeroBasedIndex: number): string {
  if (!Number.isInteger(zeroBasedIndex) || zeroBasedIndex < 0) {
    return "??";
  }
  return String(zeroBasedIndex + 1).padStart(2, "0");
}

/**
 * Deterministic UTC board date: `31 JUL 2026`.
 * Returns null when the input is missing or unparseable.
 */
export function formatDeedBoardDate(iso: string | null | undefined): string | null {
  if (iso == null || iso.trim().length === 0) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = MONTHS_UTC[d.getUTCMonth()];
  return `${day} ${month} ${d.getUTCFullYear()}`;
}

export function formatDeedReward(reward: DeedReward): string {
  switch (reward.type) {
    case "fixed":
      return `${reward.amount} LEAF`;
    case "range":
      return `${reward.min}—${reward.max} LEAF`;
    case "none":
      return "NO LEAF";
  }
}

/** Compact list summary: `text + url`. */
export function formatEvidenceSummary(
  requirements: DeedEvidenceRequirements,
): string {
  const parts = EVIDENCE_ORDER.filter((field) => requirements[field].allowed);
  if (parts.length === 0) return "none";
  return parts.join(" + ");
}

/**
 * Detail summary with required/optional:
 * `text required / url optional`
 */
export function formatEvidenceDetail(
  requirements: DeedEvidenceRequirements,
): string {
  const parts = EVIDENCE_ORDER.filter((field) => requirements[field].allowed).map(
    (field) =>
      requirements[field].required ? `${field} required` : `${field} optional`,
  );
  if (parts.length === 0) return "none";
  return parts.join(" / ");
}

export function formatRepeatability(isRepeatable: boolean): string {
  return isRepeatable ? "REPEATABLE" : "ONE COMPLETION";
}

export function formatAccessScope(scope: DeedAccessScope): string {
  switch (scope) {
    case "road":
      return "ROAD";
    case "greenwood":
      return "GREENWOOD";
    case "common":
      return "COMMON";
  }
}

export function formatCategoryLabel(category: string | null): string | null {
  if (category == null) return null;
  const trimmed = category.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}
