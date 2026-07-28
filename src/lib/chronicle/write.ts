import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isUtcDateString } from "@/lib/chronicle/dates";
import { ChronicleError } from "@/lib/chronicle/errors";
import { toPublicChronicleEntry } from "@/lib/chronicle/read";
import type {
  PublicChronicleEntry,
  WriteChronicleEntryInput,
  WriteDailyChronicleInput,
  WriteDailyChronicleResult,
} from "@/lib/chronicle/types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "23505" ||
    Boolean(error.message?.toLowerCase().includes("duplicate key"))
  );
}

function validateBody(body: string): string {
  if (typeof body !== "string" || body.trim().length === 0) {
    throw new ChronicleError(
      "chronicle_invalid_input",
      "Chronicle body must not be empty",
      400,
    );
  }
  if (body.length > 12_000) {
    throw new ChronicleError(
      "chronicle_invalid_input",
      "Chronicle body is too long",
      400,
    );
  }
  return body;
}

/**
 * Persist a DAILY Book entry. Idempotent on covered_date.
 */
export async function writeDailyChronicleEntry(
  input: WriteDailyChronicleInput,
  options?: { admin?: SupabaseClient },
): Promise<WriteDailyChronicleResult> {
  if (!isUtcDateString(input.coveredDate)) {
    throw new ChronicleError(
      "chronicle_invalid_input",
      "coveredDate must be YYYY-MM-DD UTC",
      400,
    );
  }
  const body = validateBody(input.body);
  const title =
    typeof input.title === "string" && input.title.trim().length > 0
      ? input.title.trim().slice(0, 200)
      : null;

  const admin = options?.admin ?? (await defaultAdmin());
  const sourceExternalId = `daily:${input.coveredDate}`;

  const { data, error } = await admin
    .from("chronicle_entries")
    .insert({
      kind: "daily",
      title,
      body,
      visibility: "public",
      covered_date: input.coveredDate,
      source_type: "daily_chronicle",
      source_external_id: sourceExternalId,
      created_by_actor_id: "fenn_daily_chronicle",
      metadata: {
        tone: input.tone,
        referencedFacts: input.referencedFacts,
        snapshot: {
          coveredDate: input.snapshot.coveredDate,
          quiet: input.snapshot.quiet,
          newOutlaws: input.snapshot.newOutlaws,
          campMessages: input.snapshot.campMessages,
          leafRecognisedTotal: input.snapshot.leafRecognisedTotal,
          leafRecognitionEvents: input.snapshot.leafRecognitionEvents,
          deedSubmissionsApproved: input.snapshot.deedSubmissionsApproved,
          greenwoodAdmissions: input.snapshot.greenwoodAdmissions,
          wallInscriptions: input.snapshot.wallInscriptions,
          fennXReplies: input.snapshot.fennXReplies,
          fennWallWrites: input.snapshot.fennWallWrites,
        },
        model: input.model ?? null,
      },
      published_at: `${input.coveredDate}T23:59:00.000Z`,
    })
    .select("id, kind, title, body, covered_date, published_at")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: existing, error: readError } = await admin
        .from("chronicle_entries")
        .select("id, kind, title, body, covered_date, published_at")
        .eq("kind", "daily")
        .eq("covered_date", input.coveredDate)
        .single();
      if (readError || !existing) {
        throw new ChronicleError(
          "chronicle_persist_failed",
          readError?.message || "Daily entry exists but could not be loaded",
          500,
        );
      }
      return {
        created: false,
        entry: toPublicChronicleEntry(existing),
      };
    }
    throw new ChronicleError(
      "chronicle_persist_failed",
      error.message || "Could not persist daily chronicle",
      500,
    );
  }

  return {
    created: true,
    entry: toPublicChronicleEntry(data),
  };
}

/** Exceptional CHRONICLE entry (manual / ops). Not used by the daily job. */
export async function writeChronicleEntry(
  input: WriteChronicleEntryInput,
  options?: { admin?: SupabaseClient },
): Promise<PublicChronicleEntry> {
  const body = validateBody(input.body);
  const title =
    typeof input.title === "string" && input.title.trim().length > 0
      ? input.title.trim().slice(0, 200)
      : null;
  const admin = options?.admin ?? (await defaultAdmin());

  const { data, error } = await admin
    .from("chronicle_entries")
    .insert({
      kind: "chronicle",
      title,
      body,
      visibility: "public",
      source_type: input.sourceType ?? "ops",
      source_external_id: input.sourceExternalId ?? null,
      created_by_actor_id: "fenn_ops",
      published_at: input.publishedAt ?? new Date().toISOString(),
      metadata: {},
    })
    .select("id, kind, title, body, covered_date, published_at")
    .single();

  if (error) {
    throw new ChronicleError(
      "chronicle_persist_failed",
      error.message || "Could not persist chronicle entry",
      500,
    );
  }
  return toPublicChronicleEntry(data);
}
