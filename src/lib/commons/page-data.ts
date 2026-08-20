import "server-only";

import { CommonsError } from "@/lib/commons/errors";
import { getPublicCommonsSnapshot } from "@/lib/commons/snapshot";
import type { PublicCommonsSnapshot } from "@/lib/commons/types";
import { PurseError } from "@/lib/purse/errors";
import { getPublicPurseSnapshot } from "@/lib/purse/snapshot";
import type { PublicPurseSnapshot } from "@/lib/purse/types";
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

export type CommonsPagePurse = PublicPurseSnapshot | { state: "error" };

export type CommonsPageData = {
  treasury: CommonsPageTreasury;
  commons: CommonsPageCommons;
  /** Independent of Treasury wallet status; null before token launch. */
  officialToken: PublicOfficialFennToken | null;
  /** THE PURSE — not Treasury. Independent failure boundary. */
  purse: CommonsPagePurse;
};

/**
 * Load public Treasury + Commons + Purse snapshots for `/commons`.
 * Independent failures: one section can error without inventing empty data.
 * Official token fails closed to null (no env fallback, no placeholder).
 */
export async function loadCommonsPageData(): Promise<CommonsPageData> {
  const [treasuryResult, commonsResult, officialResult, purseResult] =
    await Promise.allSettled([
      getPublicTreasurySnapshot(),
      getPublicCommonsSnapshot(),
      getPublicOfficialFennToken(),
      getPublicPurseSnapshot(),
    ]);

  return {
    treasury: mapTreasuryResult(treasuryResult),
    commons: mapCommonsResult(commonsResult),
    officialToken: mapOfficialTokenResult(officialResult, treasuryResult),
    purse: mapPurseResult(purseResult),
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
    return omitLegacyFennFromTreasury(result.value);
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
    return omitLegacyFennFromCommons(result.value);
  }
  const reason = result.reason;
  if (reason instanceof CommonsError) {
    console.error("[commons page] commons", reason.code);
  } else {
    console.error("[commons page] commons", reason);
  }
  return { state: "error" };
}

/** Legacy Robinhood $FENN must not appear on the public VELL Commons. */
function isLegacyFennSymbol(symbol: string): boolean {
  return symbol.trim().toLowerCase() === "fenn";
}

function omitLegacyFennFromTreasury(
  snapshot: PublicTreasurySnapshot,
): PublicTreasurySnapshot {
  if (snapshot.state === "unconfigured") return snapshot;
  return {
    ...snapshot,
    assets: snapshot.assets.filter((a) => !isLegacyFennSymbol(a.symbol)),
    contributions: snapshot.contributions.filter(
      (c) => !isLegacyFennSymbol(c.assetSymbol),
    ),
  };
}

function omitLegacyFennFromCommons(
  snapshot: PublicCommonsSnapshot,
): PublicCommonsSnapshot {
  const commitments = snapshot.commitments.filter(
    (c) => !isLegacyFennSymbol(c.assetSymbol),
  );
  const allocationHistory =
    snapshot.allocationHistory.state === "available"
      ? {
          state: "available" as const,
          items: snapshot.allocationHistory.items.filter(
            (item) => !isLegacyFennSymbol(item.assetSymbol),
          ),
        }
      : snapshot.allocationHistory;
  return { ...snapshot, commitments, allocationHistory };
}

function mapPurseResult(
  result: PromiseSettledResult<PublicPurseSnapshot>,
): CommonsPagePurse {
  if (result.status === "fulfilled") {
    return result.value;
  }
  const reason = result.reason;
  if (reason instanceof PurseError) {
    console.error("[commons page] purse", reason.code);
  } else {
    console.error("[commons page] purse", reason);
  }
  return { state: "error" };
}
