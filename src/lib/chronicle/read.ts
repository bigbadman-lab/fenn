import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ChronicleError } from "@/lib/chronicle/errors";
import type {
  ChronicleKind,
  PublicChronicleEntry,
} from "@/lib/chronicle/types";
import {
  CHRONICLE_KINDS,
  CHRONICLE_PUBLIC_DEFAULT_LIMIT,
  CHRONICLE_PUBLIC_MAX_LIMIT,
} from "@/lib/chronicle/types";

type ChronicleRow = {
  id: string;
  kind: string;
  title: string | null;
  body: string;
  covered_date: string | null;
  published_at: string;
  visibility?: string;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function isChronicleKind(value: string): value is ChronicleKind {
  return (CHRONICLE_KINDS as readonly string[]).includes(value);
}

export function toPublicChronicleEntry(row: ChronicleRow): PublicChronicleEntry {
  if (!isChronicleKind(row.kind)) {
    throw new ChronicleError(
      "chronicle_unavailable",
      `Unexpected chronicle kind: ${row.kind}`,
      500,
    );
  }
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    coveredDate: row.covered_date,
    publishedAt: row.published_at,
  };
}

/**
 * Public Living Book entries, newest first.
 * Includes DAILY + CHRONICLE kinds with visibility = public.
 */
export async function listPublicChronicleEntries(options?: {
  limit?: number;
  admin?: SupabaseClient;
}): Promise<PublicChronicleEntry[]> {
  const admin = options?.admin ?? (await defaultAdmin());
  const requested = options?.limit ?? CHRONICLE_PUBLIC_DEFAULT_LIMIT;
  const limit = Math.min(
    Math.max(1, Math.floor(requested)),
    CHRONICLE_PUBLIC_MAX_LIMIT,
  );

  const { data, error } = await admin
    .from("chronicle_entries")
    .select("id, kind, title, body, covered_date, published_at")
    .eq("visibility", "public")
    .in("kind", [...CHRONICLE_KINDS])
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new ChronicleError(
      "chronicle_unavailable",
      error.message || "Could not load chronicle entries",
      503,
    );
  }

  return (data ?? []).map((row) => toPublicChronicleEntry(row as ChronicleRow));
}

export async function findDailyChronicleByCoveredDate(
  coveredDate: string,
  options?: { admin?: SupabaseClient },
): Promise<PublicChronicleEntry | null> {
  const admin = options?.admin ?? (await defaultAdmin());
  const { data, error } = await admin
    .from("chronicle_entries")
    .select("id, kind, title, body, covered_date, published_at")
    .eq("kind", "daily")
    .eq("covered_date", coveredDate)
    .maybeSingle();

  if (error) {
    throw new ChronicleError(
      "chronicle_unavailable",
      error.message || "Could not load daily chronicle",
      503,
    );
  }
  if (!data) return null;
  return toPublicChronicleEntry(data as ChronicleRow);
}
