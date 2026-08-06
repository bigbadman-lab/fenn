/**
 * Stage 3 — durable Chronicler fact memory (I/O).
 * Unique (fact_key, fact_fingerprint) is the cross-post dedupe source of truth.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChroniclerReason } from "@/lib/agent/chronicler-types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export type ReserveWallFactMemoryResult =
  | {
      status: "reserved";
      memoryId: string;
    }
  | {
      status: "already_exists";
      memoryId: string | null;
    }
  | {
      status: "failed";
      error: string;
    };

export async function isWallFactFingerprintRemembered(input: {
  factKey: string;
  factFingerprint: string;
  admin?: SupabaseClient;
}): Promise<boolean> {
  const admin = input.admin ?? (await defaultAdmin());
  const { data, error } = await admin
    .from("x_wall_fact_memories")
    .select("id")
    .eq("fact_key", input.factKey)
    .eq("fact_fingerprint", input.factFingerprint)
    .maybeSingle();

  if (error) {
    // Fail closed: treat as remembered so we do not re-inscribe under uncertainty.
    console.error("[chronicler] fingerprint lookup failed", {
      code: error.message,
    });
    return true;
  }
  return data != null;
}

/**
 * Reserve a public-fact fingerprint before planning/executing Wall.
 * Unique constraint is authoritative race gate.
 */
export async function tryReserveWallFactMemory(input: {
  factKey: string;
  factFingerprint: string;
  reason: ChroniclerReason;
  perceptionEventId?: string | null;
  authorizationId?: string | null;
  observedAt?: string | null;
  admin?: SupabaseClient;
}): Promise<ReserveWallFactMemoryResult> {
  const admin = input.admin ?? (await defaultAdmin());
  const { data, error } = await admin
    .from("x_wall_fact_memories")
    .insert({
      fact_key: input.factKey,
      fact_fingerprint: input.factFingerprint,
      reason: input.reason,
      perception_event_id: input.perceptionEventId ?? null,
      authorization_id: input.authorizationId ?? null,
      observed_at: input.observedAt ?? new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (!error && data && typeof (data as { id?: string }).id === "string") {
    return { status: "reserved", memoryId: (data as { id: string }).id };
  }

  // Unique violation → already remembered.
  const code = error?.code ?? "";
  const msg = (error?.message ?? "").toLowerCase();
  if (
    code === "23505" ||
    msg.includes("duplicate") ||
    msg.includes("unique")
  ) {
    const { data: existing } = await admin
      .from("x_wall_fact_memories")
      .select("id")
      .eq("fact_key", input.factKey)
      .eq("fact_fingerprint", input.factFingerprint)
      .maybeSingle();
    return {
      status: "already_exists",
      memoryId:
        existing && typeof (existing as { id?: string }).id === "string"
          ? (existing as { id: string }).id
          : null,
    };
  }

  if (error) {
    console.error("[chronicler] reserve failed", { message: error.message });
    return { status: "failed", error: error.message };
  }

  return { status: "failed", error: "reserve returned no row" };
}

/**
 * Optional: attach wall_entry_id after successful write. Failure is non-fatal.
 */
export async function linkWallFactMemoryToEntry(input: {
  memoryId: string;
  wallEntryId: string;
  authorizationId?: string | null;
  admin?: SupabaseClient;
}): Promise<void> {
  try {
    const admin = input.admin ?? (await defaultAdmin());
    const patch: Record<string, unknown> = {
      wall_entry_id: input.wallEntryId,
    };
    if (input.authorizationId) {
      patch.authorization_id = input.authorizationId;
    }
    const { error } = await admin
      .from("x_wall_fact_memories")
      .update(patch)
      .eq("id", input.memoryId);
    if (error) {
      console.error("[chronicler] link wall_entry_id failed", {
        message: error.message,
      });
    }
  } catch (error) {
    console.error("[chronicler] link wall_entry_id threw", error);
  }
}

export async function attachAuthorizationToWallFactMemory(input: {
  memoryId: string;
  authorizationId: string;
  admin?: SupabaseClient;
}): Promise<void> {
  try {
    const admin = input.admin ?? (await defaultAdmin());
    const { error } = await admin
      .from("x_wall_fact_memories")
      .update({ authorization_id: input.authorizationId })
      .eq("id", input.memoryId);
    if (error) {
      console.error("[chronicler] attach authorization failed", {
        message: error.message,
      });
    }
  } catch (error) {
    console.error("[chronicler] attach authorization threw", error);
  }
}
