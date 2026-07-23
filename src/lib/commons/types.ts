/**
 * Current Commons commitment — amount explicitly designated to move.
 * `amount` is an exact decimal string (Postgres numeric).
 * `valueUsdManual` is operator-entered annotation — not live market pricing.
 */
export type PublicCommonsCommitment = {
  assetSymbol: string;
  amount: string;
  valueUsdManual: string | null;
};

/**
 * Signed audit delta explaining a commitment change.
 * NOT a recipient payout. NOT proof of movement.
 */
export type PublicCommonsAllocationDelta = {
  id: string;
  assetSymbol: string;
  /** Exact signed decimal string, e.g. "-12.5" or "100". */
  deltaAmount: string;
  reason: string;
  /** Minimal provenance ref only — not a joined contribution row. */
  relatedContributionId: string | null;
  createdAt: string;
};

/**
 * Commitment-change history for public Commons.
 * Distinguishes genuine empty history from a failed history query.
 */
export type PublicCommonsAllocationHistory =
  | {
      state: "available";
      items: PublicCommonsAllocationDelta[];
    }
  | {
      state: "unavailable";
    };

/**
 * Public Commons snapshot.
 * Empty commitments is a valid known state (`ready` + `[]`).
 * Authoritative commitment read failure must not become empty.
 */
export type PublicCommonsSnapshot = {
  state: "ready";
  /** When the server read this snapshot (not onchain freshness). */
  observedAt: string;
  commitments: PublicCommonsCommitment[];
  allocationHistory: PublicCommonsAllocationHistory;
};
