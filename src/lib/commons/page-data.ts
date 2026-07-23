import "server-only";

import { CommonsError } from "@/lib/commons/errors";
import { getPublicCommonsSnapshot } from "@/lib/commons/snapshot";
import type { PublicCommonsSnapshot } from "@/lib/commons/types";
import { TreasuryError } from "@/lib/treasury/errors";
import { getPublicTreasurySnapshot } from "@/lib/treasury/snapshot";
import type { PublicTreasurySnapshot } from "@/lib/treasury/types";

export type CommonsPageTreasury =
  | PublicTreasurySnapshot
  | { state: "error" };

export type CommonsPageCommons =
  | PublicCommonsSnapshot
  | { state: "error" };

export type CommonsPageData = {
  treasury: CommonsPageTreasury;
  commons: CommonsPageCommons;
};

/**
 * Load public Treasury + Commons snapshots for `/commons`.
 * Independent failures: one section can error without inventing empty data.
 */
export async function loadCommonsPageData(): Promise<CommonsPageData> {
  const [treasuryResult, commonsResult] = await Promise.allSettled([
    getPublicTreasurySnapshot(),
    getPublicCommonsSnapshot(),
  ]);

  return {
    treasury: mapTreasuryResult(treasuryResult),
    commons: mapCommonsResult(commonsResult),
  };
}

function mapTreasuryResult(
  result: PromiseSettledResult<PublicTreasurySnapshot>,
): CommonsPageTreasury {
  if (result.status === "fulfilled") {
    return result.value;
  }
  const reason = result.reason;
  if (reason instanceof TreasuryError) {
    console.error("[commons page] treasury", reason.code);
  } else {
    console.error("[commons page] treasury", reason);
  }
  return { state: "error" };
}

function mapCommonsResult(
  result: PromiseSettledResult<PublicCommonsSnapshot>,
): CommonsPageCommons {
  if (result.status === "fulfilled") {
    return result.value;
  }
  const reason = result.reason;
  if (reason instanceof CommonsError) {
    console.error("[commons page] commons", reason.code);
  } else {
    console.error("[commons page] commons", reason);
  }
  return { state: "error" };
}
