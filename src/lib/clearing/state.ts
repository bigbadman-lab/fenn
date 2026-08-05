import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ClearingError } from "@/lib/clearing/errors";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export type ClearingGlobalState = {
  readOnly: boolean;
  slowModeSeconds: number;
  updatedAt: string;
};

export async function getClearingState(
  admin?: SupabaseClient,
): Promise<ClearingGlobalState> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("clearing_state")
    .select("read_only, slow_mode_seconds, updated_at")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to load Clearing state",
      500,
    );
  }

  if (!data) {
    return { readOnly: false, slowModeSeconds: 0, updatedAt: new Date(0).toISOString() };
  }

  return {
    readOnly: Boolean(data.read_only),
    slowModeSeconds: Math.max(0, Number(data.slow_mode_seconds) || 0),
    updatedAt: String(data.updated_at),
  };
}

export async function updateClearingState(input: {
  readOnly?: boolean;
  slowModeSeconds?: number;
  updatedBy: string;
  admin?: SupabaseClient;
}): Promise<ClearingGlobalState & { previous: ClearingGlobalState }> {
  const db = input.admin ?? (await defaultAdmin());
  const previous = await getClearingState(db);
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: input.updatedBy,
  };
  if (input.readOnly !== undefined) patch.read_only = input.readOnly;
  if (input.slowModeSeconds !== undefined) {
    const n = Math.trunc(input.slowModeSeconds);
    // Bound: 0–3600; Desk UI uses discrete presets; open API still validates range.
    if (n < 0 || n > 3600) {
      throw new ClearingError(
        "clearing_invalid_request",
        "slow_mode_seconds out of range",
        400,
      );
    }
    patch.slow_mode_seconds = n;
  }

  const { data, error } = await db
    .from("clearing_state")
    .update(patch)
    .eq("id", 1)
    .select("read_only, slow_mode_seconds, updated_at")
    .single();

  if (error || !data) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to update Clearing state",
      500,
    );
  }

  return {
    readOnly: Boolean(data.read_only),
    slowModeSeconds: Math.max(0, Number(data.slow_mode_seconds) || 0),
    updatedAt: String(data.updated_at),
    previous,
  };
}
