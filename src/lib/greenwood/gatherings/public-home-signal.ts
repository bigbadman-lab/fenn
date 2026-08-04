import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  announcementStyleFromMetadata,
  announcementStyleShowsHomepageMap,
} from "@/lib/greenwood/gatherings/announcement-style";
import {
  PUBLIC_HOME_GATHERING_HREF,
  PUBLIC_HOME_GATHERING_MESSAGE,
  type PublicHomeGatheringCall,
} from "@/lib/greenwood/gatherings/public-home-signal-types";
import { resolveGatheringStateFromRow } from "@/lib/greenwood/gatherings/state";
import type { GatheringRow } from "@/lib/greenwood/gatherings/types";

export type { PublicHomeGatheringCall } from "@/lib/greenwood/gatherings/public-home-signal-types";
export {
  PUBLIC_HOME_GATHERING_HREF,
  PUBLIC_HOME_GATHERING_MESSAGE,
} from "@/lib/greenwood/gatherings/public-home-signal-types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Public-safe homepage Gathering signal.
 * Active `world_call` only — no drafts, no far-upcoming promotion.
 * Omits hands, attendance, titles, summaries, capacity, LEAF, identities.
 */
export async function getPublicHomeGatheringCall(
  admin?: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<PublicHomeGatheringCall> {
  const serverNow = new Date(nowMs).toISOString();
  try {
    const db = admin ?? (await defaultAdmin());
    const { data, error } = await db
      .from("greenwood_gatherings")
      .select("*")
      .neq("status", "draft")
      .order("starts_at", { ascending: true });

    if (error) {
      console.error("[getPublicHomeGatheringCall] query failed", {
        message: error.message,
      });
      return { active: false, serverNow };
    }

    const rows = (data ?? []) as GatheringRow[];
    const activeWorld: Array<{ row: GatheringRow; endsMs: number }> = [];

    for (const row of rows) {
      if (row.cancelled_at != null || row.status === "cancelled") continue;
      if (row.closed_at != null || row.status === "closed") continue;
      const style = announcementStyleFromMetadata(row.metadata);
      if (!announcementStyleShowsHomepageMap(style)) continue;
      const resolved = resolveGatheringStateFromRow(row, nowMs);
      if (resolved !== "active") continue;
      const endsMs = Date.parse(row.ends_at);
      if (!Number.isFinite(endsMs) || endsMs <= nowMs) continue;
      activeWorld.push({ row, endsMs });
    }

    if (activeWorld.length === 0) {
      return { active: false, serverNow };
    }

    // Nearest-ending when multiple (overlap normally prevents this).
    activeWorld.sort((a, b) => a.endsMs - b.endsMs);
    const focus = activeWorld[0]!.row;

    return {
      active: true,
      state: "active",
      startsAt: focus.starts_at,
      endsAt: focus.ends_at,
      message: PUBLIC_HOME_GATHERING_MESSAGE,
      href: PUBLIC_HOME_GATHERING_HREF,
      serverNow,
    };
  } catch (error) {
    console.error("[getPublicHomeGatheringCall] failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { active: false, serverNow };
  }
}
