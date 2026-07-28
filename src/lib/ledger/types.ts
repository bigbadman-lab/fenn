/**
 * Public Ledger recognition — types and display categories.
 * Server projection only. Not a LEAF award path.
 */

export const LEDGER_PUBLIC_CATEGORIES = [
  "DEED",
  "CAMP",
  "ADJUSTMENT",
  "SYSTEM",
  "FENN",
  "OTHER",
] as const;

export type LedgerPublicCategory = (typeof LEDGER_PUBLIC_CATEGORIES)[number];

/** Max rows per Ledger page (register-like, not infinite scroll). */
export const LEDGER_PAGE_DEFAULT = 25;
export const LEDGER_PAGE_MAX = 50;

/** Standing table size on Ledger (secondary to recognition register). */
export const LEDGER_STANDING_LIMIT = 10;

export type PublicLedgerRecognition = {
  id: string;
  createdAt: string;
  amount: number;
  lifetimeDelta: number;
  category: LedgerPublicCategory;
  /** Safe public summary — never Camp transcript or Deed evidence. */
  summary: string;
  outlawLabel: string;
  outlawNumber: number;
  /** Public Deed title when category is DEED and title is known. */
  deedTitle: string | null;
};

export type PublicLedgerTotals = {
  state: "ready";
  /** SUM(leaf_ledger.amount) — current recognition standing across Outlaws. */
  currentRecognised: number;
  /**
   * SUM of positive lifetime_delta only — all-time positive recognition awarded.
   * Corrections that reduce lifetime are excluded from this total by design.
   */
  lifetimeRecognised: number;
  entryCount: number;
};

export type PublicLedgerStandingRow = {
  rank: number;
  outlawLabel: string;
  outlawNumber: number;
  lifetimeLeaf: number;
};

export type PublicLedgerPageData =
  | {
      state: "ready";
      totals: PublicLedgerTotals;
      entries: PublicLedgerRecognition[];
      nextCursor: { createdAt: string; id: string } | null;
      standing: PublicLedgerStandingRow[];
    }
  | { state: "unavailable" };
