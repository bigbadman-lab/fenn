import type { LeafSourceType } from "@/lib/leaf/types";
import type { LedgerPublicCategory } from "@/lib/ledger/types";
import { formatOutlawNumber } from "@/lib/profiles/types";

export type LedgerNormalizeInput = {
  sourceType: string;
  amount: number;
  reason: string;
  /** Optional public Deed title from trusted join (never evidence). */
  deedTitle?: string | null;
  outlawNumber: number;
  alias: string | null;
};

/**
 * Map authoritative leaf_ledger.source_type → public Ledger category.
 * Does not invent FENN recognition — `system` stays SYSTEM until a real
 * FENN-authorised path exists; FENN is reserved for that future source.
 */
export function toLedgerPublicCategory(
  sourceType: string,
): LedgerPublicCategory {
  switch (sourceType) {
    case "deed":
      return "DEED";
    case "camp":
      return "CAMP";
    case "onboarding":
      return "SYSTEM";
    case "invite":
      return "SYSTEM";
    case "admin_adjustment":
      return "ADJUSTMENT";
    case "system":
      return "SYSTEM";
    case "fenn":
      // Future-compatible: schema does not yet allow this CHECK value.
      return "VELL";
    default:
      return "OTHER";
  }
}

export function formatLedgerOutlawLabel(
  outlawNumber: number,
  alias: string | null,
): string {
  const trimmed = alias?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed.toUpperCase();
  }
  return `OUTLAW ${formatOutlawNumber(outlawNumber)}`;
}

/**
 * Safe public summary. Never echoes private Camp text or Deed evidence.
 * Uses only source_type + optional public deed title + amount sign.
 */
export function toLedgerPublicSummary(input: {
  category: LedgerPublicCategory;
  amount: number;
  deedTitle?: string | null;
  reason: string;
}): string {
  const { category, amount, deedTitle } = input;

  if (category === "CAMP") {
    return amount >= 0
      ? "A conversation mattered."
      : "A prior Camp recognition was corrected.";
  }

  if (category === "DEED") {
    const title = deedTitle?.trim();
    if (title && title.length > 0) {
      return amount >= 0
        ? `A deed was recognised: ${truncateTitle(title)}`
        : `A prior Deed recognition was corrected: ${truncateTitle(title)}`;
    }
    return amount >= 0
      ? "A deed was recognised."
      : "A prior Deed recognition was corrected.";
  }

  if (category === "ADJUSTMENT") {
    return amount >= 0
      ? "Recognition was adjusted."
      : "A prior recognition was corrected.";
  }

  if (category === "VELL") {
    return amount >= 0
      ? "VELL recognised a contribution."
      : "A prior VELL recognition was corrected.";
  }

  if (category === "SYSTEM") {
    return amount >= 0
      ? "Recognition was recorded."
      : "A prior recognition was corrected.";
  }

  return amount >= 0
    ? "Recognition was recorded."
    : "A prior recognition was corrected.";
}

function truncateTitle(title: string, max = 80): string {
  if (title.length <= max) return title;
  return `${title.slice(0, max - 1)}…`;
}

/** Assert known LeafSourceType for tests / guards. */
export function isKnownLeafSourceType(value: string): value is LeafSourceType {
  return (
    value === "camp" ||
    value === "deed" ||
    value === "admin_adjustment" ||
    value === "system" ||
    value === "hollow" ||
    value === "onboarding" ||
    value === "invite"
  );
}

export function normalizeLedgerRecognition(
  input: LedgerNormalizeInput,
): {
  category: LedgerPublicCategory;
  summary: string;
  outlawLabel: string;
  deedTitle: string | null;
} {
  const category = toLedgerPublicCategory(input.sourceType);
  const deedTitle =
    category === "DEED" && input.deedTitle?.trim()
      ? input.deedTitle.trim()
      : null;
  return {
    category,
    summary: toLedgerPublicSummary({
      category,
      amount: input.amount,
      deedTitle,
      reason: input.reason,
    }),
    outlawLabel: formatLedgerOutlawLabel(input.outlawNumber, input.alias),
    deedTitle,
  };
}
