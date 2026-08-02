import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DeskFireMember,
  DeskFireSnapshot,
} from "@/lib/desk/fire-types";
import { resolveGatheringStateFromRow } from "@/lib/greenwood/gatherings/state";
import type { GatheringRow } from "@/lib/greenwood/gatherings/types";
import { isFirePresenceActive } from "@/lib/greenwood/presence/filter";
import { DESK_CURRENT_SIGIL_MARK_SELECT } from "@/lib/greenwood/sigil/embeds";
import { assertSafeIntegerAmount } from "@/lib/leaf/validate";
import { formatOutlawNumber } from "@/lib/profiles/types";

type PresenceJoinRow = {
  profile_id: string;
  last_seen_at: string;
  sitting: boolean;
  profiles: {
    outlaw_number: number | string;
    alias: string | null;
    greenwood_entered_at: string | null;
  } | null;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Desk Fire presence — timeout-filtered, includes profile IDs for Register links.
 * Does not mutate presence. Does not expose wallets.
 */
export async function getDeskFireSnapshot(
  nowMs: number = Date.now(),
): Promise<DeskFireSnapshot> {
  const db = await defaultAdmin();

  const { data, error } = await db.from("greenwood_presence").select(
    `
      profile_id,
      last_seen_at,
      sitting,
      profiles!inner (
        outlaw_number,
        alias,
        greenwood_entered_at
      )
    `,
  );

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as PresenceJoinRow[];
  const activeRows = rows.filter((row) => {
    const profile = row.profiles;
    if (!profile || profile.greenwood_entered_at == null) return false;
    return isFirePresenceActive(row.last_seen_at, nowMs);
  });

  const sigilByProfile = new Map<
    string,
    { asciiBody: string; a11yLabel: string }
  >();
  if (activeRows.length > 0) {
    const ids = activeRows.map((row) => row.profile_id);
    const { data: sigilRows, error: sigilError } = await db
      .from("greenwood_sigil_assignments")
      .select(DESK_CURRENT_SIGIL_MARK_SELECT)
      .in("profile_id", ids);
    if (sigilError) throw new Error(sigilError.message);
    for (const raw of sigilRows ?? []) {
      const r = raw as unknown as {
        profile_id: string;
        greenwood_sigil_catalogue:
          | { ascii_body: string; a11y_label: string }
          | { ascii_body: string; a11y_label: string }[]
          | null;
      };
      const cat = Array.isArray(r.greenwood_sigil_catalogue)
        ? r.greenwood_sigil_catalogue[0]
        : r.greenwood_sigil_catalogue;
      if (!cat) continue;
      sigilByProfile.set(r.profile_id, {
        asciiBody: cat.ascii_body,
        a11yLabel: cat.a11y_label,
      });
    }
  }

  // Active Gathering + open hands
  const { data: gatherings, error: gError } = await db
    .from("greenwood_gatherings")
    .select("*")
    .order("starts_at", { ascending: false })
    .limit(40);
  if (gError) throw new Error(gError.message);

  let activeGathering: DeskFireSnapshot["activeGathering"] = null;
  const raisedProfileIds = new Set<string>();

  for (const row of (gatherings ?? []) as GatheringRow[]) {
    if (resolveGatheringStateFromRow(row, nowMs) !== "active") continue;
    const { data: hands, error: hError } = await db
      .from("greenwood_gathering_hands")
      .select("profile_id")
      .eq("gathering_id", row.id)
      .is("lowered_at", null);
    if (hError) throw new Error(hError.message);
    const handCount = hands?.length ?? 0;
    for (const hand of hands ?? []) {
      raisedProfileIds.add(String((hand as { profile_id: string }).profile_id));
    }
    activeGathering = {
      id: row.id,
      title: row.title,
      handCount,
      endsAt: row.ends_at,
    };
    break;
  }

  const members: DeskFireMember[] = [];
  for (const row of activeRows) {
    const profile = row.profiles;
    if (!profile) continue;
    const outlawNumber = assertSafeIntegerAmount(
      profile.outlaw_number,
      "outlaw_number",
      "UNSAFE_BIGINT",
    );
    const outlawLabel = formatOutlawNumber(outlawNumber);
    const alias = profile.alias?.trim() || null;
    const sigil = sigilByProfile.get(row.profile_id) ?? null;
    members.push({
      profileId: row.profile_id,
      displayName: alias ?? `Outlaw ${outlawLabel}`,
      outlawNumberLabel: outlawLabel,
      sigil,
      state: row.sitting ? "sitting" : "present",
      handRaised: raisedProfileIds.has(row.profile_id),
    });
  }

  members.sort((a, b) => {
    if (a.state !== b.state) return a.state === "sitting" ? -1 : 1;
    return a.outlawNumberLabel.localeCompare(b.outlawNumberLabel);
  });

  const sittingCount = members.filter((m) => m.state === "sitting").length;

  return {
    generatedAt: new Date(nowMs).toISOString(),
    activeCount: members.length,
    sittingCount,
    members,
    activeGathering,
  };
}
