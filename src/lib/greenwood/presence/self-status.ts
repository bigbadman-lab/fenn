import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { GreenwoodError } from "@/lib/greenwood/errors";
import { isFirePresenceActive } from "@/lib/greenwood/presence/filter";
import type { FireSelfStatus } from "@/lib/greenwood/presence/types";
import { assertProfileId } from "@/lib/leaf/validate";

export type { FireSelfStatus };

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Compact Fire self-status for shell / cross-route heartbeat ownership.
 * Returns only member/active/sitting — no identities or catalogues.
 */
export async function getFireSelfStatus(
  profileId: string,
  admin?: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<FireSelfStatus> {
  const id = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("greenwood_entered_at")
    .eq("id", id)
    .maybeSingle();

  if (profileError) {
    throw new GreenwoodError(
      "greenwood_presence_failed",
      "Failed to verify Greenwood membership",
      500,
    );
  }
  if (!profile) {
    return { member: false, active: false, sitting: false };
  }
  if (
    (profile as { greenwood_entered_at: string | null }).greenwood_entered_at ==
    null
  ) {
    return { member: false, active: false, sitting: false };
  }

  const { data: row, error } = await db
    .from("greenwood_presence")
    .select("last_seen_at, sitting")
    .eq("profile_id", id)
    .maybeSingle();

  if (error) {
    throw new GreenwoodError(
      "greenwood_presence_failed",
      "Failed to load Fire self status",
      500,
    );
  }
  if (!row) {
    return { member: true, active: false, sitting: false };
  }

  const presence = row as { last_seen_at: string; sitting: boolean };
  const active = isFirePresenceActive(presence.last_seen_at, nowMs);
  return {
    member: true,
    active,
    sitting: active && Boolean(presence.sitting),
  };
}
