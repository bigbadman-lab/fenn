import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { utcDayBounds } from "@/lib/chronicle/dates";
import { ChronicleError } from "@/lib/chronicle/errors";
import type { DailyWorldSnapshot } from "@/lib/chronicle/types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type FilterableCount = {
  gte: (column: string, value: string) => FilterableCount;
  lt: (column: string, value: string) => FilterableCount;
  eq: (column: string, value: string) => FilterableCount;
};

async function headCount(
  admin: SupabaseClient,
  table: string,
  apply: (q: FilterableCount) => FilterableCount,
): Promise<number> {
  const base = admin.from(table).select("id", {
    count: "exact",
    head: true,
  }) as unknown as FilterableCount;
  const result = (await apply(base)) as unknown as {
    count: number | null;
    error: { message: string } | null;
  };
  if (result.error) {
    throw new ChronicleError(
      "chronicle_unavailable",
      `${table}: ${result.error.message}`,
      503,
    );
  }
  return typeof result.count === "number" ? result.count : 0;
}

async function sumLeaf(
  admin: SupabaseClient,
  startIso: string,
  endIso: string,
  sourceType?: string,
): Promise<{ total: number; events: number }> {
  let q = admin
    .from("leaf_ledger")
    .select("amount")
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  if (sourceType) q = q.eq("source_type", sourceType);
  const { data, error } = await q;
  if (error) {
    throw new ChronicleError(
      "chronicle_unavailable",
      `leaf_ledger: ${error.message}`,
      503,
    );
  }
  const rows = data ?? [];
  return {
    events: rows.length,
    total: rows.reduce(
      (sum, row) => sum + (typeof row.amount === "number" ? row.amount : 0),
      0,
    ),
  };
}

/**
 * Deterministic trusted daily snapshot.
 * Counts and aggregates only — never Camp bodies or Deed evidence.
 */
export async function buildDailyWorldSnapshot(
  coveredDate: string,
  options?: { admin?: SupabaseClient },
): Promise<DailyWorldSnapshot> {
  const admin = options?.admin ?? (await defaultAdmin());
  let startIso: string;
  let endIso: string;
  try {
    ({ startIso, endIso } = utcDayBounds(coveredDate));
  } catch {
    throw new ChronicleError(
      "chronicle_invalid_input",
      `Invalid covered date: ${coveredDate}`,
      400,
    );
  }

  const [
    newOutlaws,
    campMessages,
    campLeaf,
    leafAll,
    deedsCreated,
    deedSubmissionsCreated,
    deedSubmissionsApproved,
    deedSubmissionsRejected,
    greenwoodAdmissions,
    wallInscriptions,
    fennXReplies,
    fennWallWrites,
    commonsAllocationEvents,
  ] = await Promise.all([
    headCount(admin, "profiles", (q) =>
      q.gte("created_at", startIso).lt("created_at", endIso),
    ),
    headCount(admin, "camp_messages", (q) =>
      q.gte("created_at", startIso).lt("created_at", endIso),
    ),
    sumLeaf(admin, startIso, endIso, "camp"),
    sumLeaf(admin, startIso, endIso),
    headCount(admin, "deeds", (q) =>
      q.gte("created_at", startIso).lt("created_at", endIso),
    ),
    headCount(admin, "deed_submissions", (q) =>
      q.gte("created_at", startIso).lt("created_at", endIso),
    ),
    headCount(admin, "deed_submissions", (q) =>
      q
        .eq("status", "approved")
        .gte("reviewed_at", startIso)
        .lt("reviewed_at", endIso),
    ),
    headCount(admin, "deed_submissions", (q) =>
      q
        .eq("status", "rejected")
        .gte("reviewed_at", startIso)
        .lt("reviewed_at", endIso),
    ),
    headCount(admin, "profiles", (q) =>
      q
        .gte("greenwood_entered_at", startIso)
        .lt("greenwood_entered_at", endIso),
    ),
    headCount(admin, "wall_entries", (q) =>
      q.gte("created_at", startIso).lt("created_at", endIso),
    ),
    headCount(admin, "x_perception_effects", (q) =>
      q
        .eq("status", "completed")
        .eq("effect_type", "reply_on_x")
        .gte("completed_at", startIso)
        .lt("completed_at", endIso),
    ),
    headCount(admin, "x_perception_effects", (q) =>
      q
        .eq("status", "completed")
        .eq("effect_type", "write_to_wall")
        .gte("completed_at", startIso)
        .lt("completed_at", endIso),
    ),
    headCount(admin, "commons_allocations", (q) =>
      q.gte("created_at", startIso).lt("created_at", endIso),
    ),
  ]);

  const snapshot: DailyWorldSnapshot = {
    coveredDate,
    dayStartIso: startIso,
    dayEndIso: endIso,
    newOutlaws,
    campMessages,
    campLeafRecognised: campLeaf.total,
    leafRecognisedTotal: leafAll.total,
    leafRecognitionEvents: leafAll.events,
    deedsCreated,
    deedSubmissionsCreated,
    deedSubmissionsApproved,
    deedSubmissionsRejected,
    greenwoodAdmissions,
    wallInscriptions,
    fennXReplies,
    fennWallWrites,
    commonsAllocationEvents,
    quiet: false,
  };
  snapshot.quiet = isQuietDay(snapshot);
  return snapshot;
}

export function isQuietDay(snapshot: DailyWorldSnapshot): boolean {
  return (
    snapshot.newOutlaws === 0 &&
    snapshot.campMessages === 0 &&
    snapshot.leafRecognitionEvents === 0 &&
    snapshot.deedsCreated === 0 &&
    snapshot.deedSubmissionsCreated === 0 &&
    snapshot.deedSubmissionsApproved === 0 &&
    snapshot.greenwoodAdmissions === 0 &&
    snapshot.wallInscriptions === 0 &&
    snapshot.fennXReplies === 0 &&
    snapshot.fennWallWrites === 0 &&
    snapshot.commonsAllocationEvents === 0
  );
}

export function snapshotFactCatalog(
  snapshot: DailyWorldSnapshot,
): Record<string, number | boolean | string> {
  return {
    coveredDate: snapshot.coveredDate,
    newOutlaws: snapshot.newOutlaws,
    campMessages: snapshot.campMessages,
    campLeafRecognised: snapshot.campLeafRecognised,
    leafRecognisedTotal: snapshot.leafRecognisedTotal,
    leafRecognitionEvents: snapshot.leafRecognitionEvents,
    deedsCreated: snapshot.deedsCreated,
    deedSubmissionsCreated: snapshot.deedSubmissionsCreated,
    deedSubmissionsApproved: snapshot.deedSubmissionsApproved,
    deedSubmissionsRejected: snapshot.deedSubmissionsRejected,
    greenwoodAdmissions: snapshot.greenwoodAdmissions,
    wallInscriptions: snapshot.wallInscriptions,
    fennXReplies: snapshot.fennXReplies,
    fennWallWrites: snapshot.fennWallWrites,
    commonsAllocationEvents: snapshot.commonsAllocationEvents,
    quiet: snapshot.quiet,
  };
}
