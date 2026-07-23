import "server-only";

import {
  getCommonsAllocationHistory,
  getCommonsCommitments,
  PUBLIC_COMMONS_ALLOCATION_HISTORY_LIMIT,
} from "@/lib/commons/commitments";
import { CommonsError } from "@/lib/commons/errors";
import type {
  PublicCommonsAllocationDelta,
  PublicCommonsCommitment,
  PublicCommonsSnapshot,
} from "@/lib/commons/types";

export type CommonsSnapshotDeps = {
  getCommitments: () => Promise<PublicCommonsCommitment[]>;
  getAllocationHistory: () => Promise<PublicCommonsAllocationDelta[]>;
  now: () => Date;
};

const defaultDeps: CommonsSnapshotDeps = {
  getCommitments: () => getCommonsCommitments(),
  getAllocationHistory: () =>
    getCommonsAllocationHistory(undefined, PUBLIC_COMMONS_ALLOCATION_HISTORY_LIMIT),
  now: () => new Date(),
};

/**
 * Authoritative public Commons snapshot.
 *
 * Current commitment amounts come only from `commons_commitments`.
 * Allocation rows are explanatory history — never summed into current amounts.
 * No Treasury subtraction. No Circulations.
 */
export async function getPublicCommonsSnapshot(
  overrides?: Partial<CommonsSnapshotDeps>,
): Promise<PublicCommonsSnapshot> {
  const deps: CommonsSnapshotDeps = { ...defaultDeps, ...overrides };
  const observedAt = deps.now().toISOString();

  // Commitments are product truth — failure must not become empty.
  const commitments = await deps.getCommitments();

  let allocationHistory: PublicCommonsSnapshot["allocationHistory"];
  try {
    const items = await deps.getAllocationHistory();
    allocationHistory = { state: "available", items };
  } catch (error) {
    if (error instanceof CommonsError) {
      console.error(
        "[commons] allocation history unavailable",
        error.code,
      );
      allocationHistory = { state: "unavailable" };
    } else {
      throw error;
    }
  }

  return {
    state: "ready",
    observedAt,
    commitments,
    allocationHistory,
  };
}

export { PUBLIC_COMMONS_ALLOCATION_HISTORY_LIMIT };
