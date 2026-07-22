import "server-only";

/**
 * Public Stage 4 LEAF engine surface.
 * Does not export writeLeafEntry — feature code must use awardLeaf / adminAdjustLeaf.
 */

export { awardLeaf } from "@/lib/leaf/award";
export { adminAdjustLeaf } from "@/lib/leaf/adjust";
export {
  getLeafBalance,
  getLeafLifetimeEarned,
  getLeafHistory,
  reconcileLeafCaches,
} from "@/lib/leaf/reads";
export { getStandingSnapshot } from "@/lib/leaf/standing";
export { LeafError, type LeafErrorCode } from "@/lib/leaf/errors";
export { leafIdempotencyKeys } from "@/lib/leaf/validate";
export type {
  AwardLeafInput,
  AdminAdjustLeafInput,
  LeafHistoryOptions,
  LeafHistoryPage,
  LeafMutationResult,
  LeafReconciliationResult,
  SafeLeafLedgerEntry,
  StandingSnapshot,
} from "@/lib/leaf/types";
