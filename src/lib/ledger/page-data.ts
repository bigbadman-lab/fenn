import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertSafeIntegerAmount } from "@/lib/leaf/validate";
import {
  formatLedgerOutlawLabel,
  normalizeLedgerRecognition,
} from "@/lib/ledger/normalize";
import {
  LEDGER_PAGE_DEFAULT,
  LEDGER_PAGE_MAX,
  LEDGER_STANDING_LIMIT,
  type PublicLedgerPageData,
  type PublicLedgerRecognition,
  type PublicLedgerStandingRow,
  type PublicLedgerTotals,
} from "@/lib/ledger/types";

function parseLimit(limit?: number): number {
  const n = Math.floor(limit ?? LEDGER_PAGE_DEFAULT);
  if (!Number.isFinite(n) || n < 1) return LEDGER_PAGE_DEFAULT;
  return Math.min(n, LEDGER_PAGE_MAX);
}

function deedTitleFromReason(reason: string): string | null {
  if (reason.startsWith("Deed approved: ")) {
    const title = reason.slice("Deed approved: ".length).trim();
    return title.length > 0 ? title : null;
  }
  return null;
}

export async function getPublicLeafRecognitionTotals(): Promise<PublicLedgerTotals> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_public_leaf_recognition_totals");

  if (error) {
    throw new Error(`ledger totals failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = (rows[0] ?? null) as Record<string, unknown> | null;
  if (!row) {
    return {
      state: "ready",
      currentRecognised: 0,
      lifetimeRecognised: 0,
      entryCount: 0,
    };
  }

  return {
    state: "ready",
    currentRecognised: assertSafeIntegerAmount(
      row.current_recognised,
      "current_recognised",
      "UNSAFE_BIGINT",
    ),
    lifetimeRecognised: assertSafeIntegerAmount(
      row.lifetime_recognised,
      "lifetime_recognised",
      "UNSAFE_BIGINT",
    ),
    entryCount: assertSafeIntegerAmount(
      row.entry_count,
      "entry_count",
      "UNSAFE_BIGINT",
    ),
  };
}

type RawLedgerRow = {
  id: string;
  amount: number | string;
  lifetime_delta: number | string;
  source_type: string;
  reason: string;
  created_at: string;
  profiles:
    | { outlaw_number: number; alias: string | null }
    | Array<{ outlaw_number: number; alias: string | null }>
    | null;
};

export async function listPublicLeafRecognitions(
  options: {
    cursor?: { createdAt: string; id: string } | null;
    limit?: number;
  } = {},
): Promise<{
  entries: PublicLedgerRecognition[];
  nextCursor: { createdAt: string; id: string } | null;
}> {
  const admin = createAdminClient();
  const limit = parseLimit(options.limit);

  let query = admin
    .from("leaf_ledger")
    .select(
      "id, amount, lifetime_delta, source_type, reason, created_at, profiles!inner(outlaw_number, alias)",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (options.cursor?.createdAt && options.cursor?.id) {
    const createdAt = options.cursor.createdAt;
    const cursorId = options.cursor.id;
    query = query.or(
      `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${cursorId})`,
    );
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`ledger list failed: ${error.message}`);
  }

  const rows = (data as RawLedgerRow[] | null) ?? [];
  const pageRows = rows.slice(0, limit);
  const entries: PublicLedgerRecognition[] = [];

  for (const row of pageRows) {
    const profileRaw = Array.isArray(row.profiles)
      ? row.profiles[0]
      : row.profiles;
    if (!profileRaw || typeof profileRaw.outlaw_number !== "number") continue;

    const amount = assertSafeIntegerAmount(row.amount, "amount", "UNSAFE_BIGINT");
    const lifetimeDelta = assertSafeIntegerAmount(
      row.lifetime_delta,
      "lifetime_delta",
      "UNSAFE_BIGINT",
    );
    const deedTitle = deedTitleFromReason(row.reason);
    const normalized = normalizeLedgerRecognition({
      sourceType: row.source_type,
      amount,
      reason: row.reason,
      deedTitle,
      outlawNumber: profileRaw.outlaw_number,
      alias: profileRaw.alias,
    });

    entries.push({
      id: row.id,
      createdAt: row.created_at,
      amount,
      lifetimeDelta,
      category: normalized.category,
      summary: normalized.summary,
      outlawLabel: normalized.outlawLabel,
      outlawNumber: profileRaw.outlaw_number,
      deedTitle: normalized.deedTitle,
    });
  }

  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? { createdAt: last.created_at, id: last.id }
      : null;

  return { entries, nextCursor };
}

export async function listPublicLeafStanding(
  limit = LEDGER_STANDING_LIMIT,
): Promise<PublicLedgerStandingRow[]> {
  const admin = createAdminClient();
  const n = Math.max(1, Math.min(Math.floor(limit), 50));

  const { data, error } = await admin
    .from("profiles")
    .select("outlaw_number, alias, leaf_lifetime_earned")
    .gt("leaf_lifetime_earned", 0)
    .order("leaf_lifetime_earned", { ascending: false })
    .order("outlaw_number", { ascending: true })
    .limit(n);

  if (error) {
    throw new Error(`ledger standing failed: ${error.message}`);
  }

  return (data ?? []).map((row, index) => {
    const lifetimeLeaf = assertSafeIntegerAmount(
      row.leaf_lifetime_earned,
      "leaf_lifetime_earned",
      "UNSAFE_BIGINT",
    );
    return {
      rank: index + 1,
      outlawLabel: formatLedgerOutlawLabel(row.outlaw_number, row.alias),
      outlawNumber: row.outlaw_number,
      lifetimeLeaf,
    };
  });
}

/**
 * Assemble public Ledger page payload. Failures → unavailable (no fake zeros).
 */
export async function loadLedgerPageData(
  options: {
    cursor?: { createdAt: string; id: string } | null;
    limit?: number;
  } = {},
): Promise<PublicLedgerPageData> {
  try {
    const [totals, list, standing] = await Promise.all([
      getPublicLeafRecognitionTotals(),
      listPublicLeafRecognitions(options),
      listPublicLeafStanding(),
    ]);

    return {
      state: "ready",
      totals,
      entries: list.entries,
      nextCursor: list.nextCursor,
      standing,
    };
  } catch (error) {
    console.error(
      "[ledger page]",
      error instanceof Error ? error.message : error,
    );
    return { state: "unavailable" };
  }
}
