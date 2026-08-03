import "server-only";

import { CommonsError } from "@/lib/commons/errors";
import { getPublicCommonsSnapshot } from "@/lib/commons/snapshot";
import type { PublicCommonsSnapshot } from "@/lib/commons/types";
import { TreasuryError } from "@/lib/treasury/errors";
import { getPublicOfficialFennToken } from "@/lib/treasury/official-token";
import { getPublicTreasurySnapshot } from "@/lib/treasury/snapshot";
import type {
  PublicOfficialFennToken,
  PublicTreasurySnapshot,
} from "@/lib/treasury/types";

export type CommonsPageTreasury =
  | PublicTreasurySnapshot
  | { state: "error" };

export type CommonsPageCommons =
  | PublicCommonsSnapshot
  | { state: "error" };

export type CommonsPageData = {
  treasury: CommonsPageTreasury;
  commons: CommonsPageCommons;
  /** Independent of Treasury wallet status; null before token launch. */
  officialToken: PublicOfficialFennToken | null;
};

/**
 * Load public Treasury + Commons snapshots for `/commons`.
 * Independent failures: one section can error without inventing empty data.
 * Official token fails closed to null (no env fallback, no placeholder).
 */
export async function loadCommonsPageData(): Promise<CommonsPageData> {
  const [treasuryResult, commonsResult, officialResult] = await Promise.allSettled([
    getPublicTreasurySnapshot(),
    getPublicCommonsSnapshot(),
    getPublicOfficialFennToken(),
  ]);

  return {
    treasury: mapTreasuryResult(treasuryResult),
    commons: mapCommonsResult(commonsResult),
    officialToken: mapOfficialTokenResult(officialResult, treasuryResult),
  };
}

function mapOfficialTokenResult(
  result: PromiseSettledResult<PublicOfficialFennToken | null>,
  treasuryResult: PromiseSettledResult<PublicTreasurySnapshot>,
): PublicOfficialFennToken | null {
  if (result.status === "fulfilled") {
    return result.value;
  }
  // Soft-fallback to snapshot value if dedicated lookup path failed oddly.
  if (treasuryResult.status === "fulfilled") {
    return treasuryResult.value.officialToken;
  }
  console.error("[commons page] official token", result.reason);
  return null;
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
