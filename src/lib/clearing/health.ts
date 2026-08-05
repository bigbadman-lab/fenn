import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isClearingCookieSecretConfigured,
} from "@/lib/clearing/cookie";
import { getClearingState } from "@/lib/clearing/state";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export type ClearingHealthSnapshot = {
  databaseReachable: boolean;
  stateReadable: boolean;
  rateLimitRpcAvailable: boolean;
  cookieSecretConfigured: boolean;
  readOnly: boolean | null;
  slowModeSeconds: number | null;
  latestPublishedAt: string | null;
  latestModerationAt: string | null;
  checkedAt: string;
};

/**
 * Desk-only operational health. Never expose publicly.
 * Probes with lightweight service-role reads; fails closed / honest booleans.
 */
export async function getClearingHealth(
  admin?: SupabaseClient,
): Promise<ClearingHealthSnapshot> {
  const db = admin ?? (await defaultAdmin());
  const checkedAt = new Date().toISOString();
  const cookieSecretConfigured = isClearingCookieSecretConfigured();

  let databaseReachable = false;
  let stateReadable = false;
  let rateLimitRpcAvailable = false;
  let readOnly: boolean | null = null;
  let slowModeSeconds: number | null = null;
  let latestPublishedAt: string | null = null;
  let latestModerationAt: string | null = null;

  try {
    const { error } = await db
      .from("clearing_state")
      .select("id")
      .eq("id", 1)
      .maybeSingle();
    databaseReachable = !error;
  } catch {
    databaseReachable = false;
  }

  try {
    const state = await getClearingState(db);
    stateReadable = true;
    readOnly = state.readOnly;
    slowModeSeconds = state.slowModeSeconds;
  } catch {
    stateReadable = false;
  }

  try {
    // Probe RPC with zero max → returns 0 without mutating usefully
    const { error } = await db.rpc("consume_clearing_rate_bucket", {
      p_bucket_key: "__health_probe__",
      p_window_start: new Date(0).toISOString(),
      p_max_hits: 0,
    });
    // max 0 may short-circuit as error or return — either path with no infra crash = ok
    rateLimitRpcAvailable = !error || String(error.message).length > 0;
    // Prefer: if function missing, PostgREST returns specific error
    if (error && /could not find|schema cache|does not exist/i.test(error.message)) {
      rateLimitRpcAvailable = false;
    } else if (!error) {
      rateLimitRpcAvailable = true;
    } else if (/rate_limited|invalid/i.test(error.message)) {
      rateLimitRpcAvailable = true;
    } else {
      rateLimitRpcAvailable = false;
    }
  } catch {
    rateLimitRpcAvailable = false;
  }

  try {
    const { data } = await db
      .from("clearing_messages")
      .select("created_at")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestPublishedAt = data?.created_at ? String(data.created_at) : null;
  } catch {
    latestPublishedAt = null;
  }

  try {
    const { data } = await db
      .from("clearing_moderation_log")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestModerationAt = data?.created_at ? String(data.created_at) : null;
  } catch {
    latestModerationAt = null;
  }

  return {
    databaseReachable,
    stateReadable,
    rateLimitRpcAvailable,
    cookieSecretConfigured,
    readOnly,
    slowModeSeconds,
    latestPublishedAt,
    latestModerationAt,
    checkedAt,
  };
}
