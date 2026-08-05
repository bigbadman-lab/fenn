/**
 * Status / publish policy for classified Market Watch events.
 * Dry-run never publishes. Live disposals stay non-public.
 */

import type {
  MarketWatchEventStatus,
  MarketWatchEventType,
  MarketWatchMode,
} from "@/lib/market-watch/types";

export type PersistStatusDecision = {
  status: MarketWatchEventStatus;
  publishedAt: string | null;
  suppressReason: string | null;
};

/**
 * Decide persistence status without floating point.
 */
export function decideEventStatus(input: {
  mode: MarketWatchMode;
  eventType: MarketWatchEventType;
  fennAmountRaw: bigint;
  minDisplayFennRaw: bigint;
  alreadySuppressed?: boolean;
  suppressReason?: string | null;
}): PersistStatusDecision {
  if (input.alreadySuppressed) {
    return {
      status: "suppressed",
      publishedAt: null,
      suppressReason: input.suppressReason ?? "classified_suppress",
    };
  }

  // Below threshold: still retained, never published.
  if (input.fennAmountRaw < input.minDisplayFennRaw) {
    return {
      status: "suppressed",
      publishedAt: null,
      suppressReason: "below_min_display",
    };
  }

  // Dry-run / disabled path: observe only.
  if (input.mode !== "live") {
    return {
      status: "observed",
      publishedAt: null,
      suppressReason: null,
    };
  }

  // Live: only acquisitions are Clearing-eligible (published).
  if (input.eventType === "acquisition") {
    const now = new Date().toISOString();
    return {
      status: "published",
      publishedAt: now,
      suppressReason: null,
    };
  }

  // Live disposal: stored non-public for future policy.
  return {
    status: "observed",
    publishedAt: null,
    suppressReason: null,
  };
}

/**
 * Canonical opaque event identity for logs/tests.
 */
export function canonicalEventKey(input: {
  chainId: number;
  transactionHash: string;
  logIndex: number;
}): string {
  return `${input.chainId}:${input.transactionHash.toLowerCase()}:${input.logIndex}`;
}
