import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { GreenwoodError } from "@/lib/greenwood/errors";
import {
  compareFirePresenceMembers,
  isFirePresenceActive,
} from "@/lib/greenwood/presence/filter";
import type {
  FirePresenceMember,
  FirePresenceSnapshot,
  GreenwoodPresenceRpcRow,
} from "@/lib/greenwood/presence/types";
import { PRESENCE_CURRENT_SIGIL_SELECT } from "@/lib/greenwood/sigil/embeds";
import type { SafeGreenwoodSigil } from "@/lib/greenwood/sigil/types";
import { formatOutlawNumber } from "@/lib/profiles/types";
import { assertProfileId, assertSafeIntegerAmount } from "@/lib/leaf/validate";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type PresenceSelf = {
  present: boolean;
  sitting: boolean;
};

function mapPresenceRpcError(message: string): GreenwoodError {
  if (message.includes("FENN_PROFILE_NOT_FOUND")) {
    return new GreenwoodError(
      "greenwood_presence_failed",
      "Profile not found for Fire presence",
      404,
    );
  }
  if (message.includes("FENN_GREENWOOD_MEMBERSHIP_REQUIRED")) {
    return new GreenwoodError(
      "greenwood_membership_required",
      "Greenwood membership required for Fire presence",
      403,
    );
  }
  if (message.includes("FENN_VALIDATION")) {
    return new GreenwoodError(
      "greenwood_presence_failed",
      "Fire presence validation failed",
      400,
    );
  }
  return new GreenwoodError(
    "greenwood_presence_failed",
    "Fire presence update failed",
    500,
  );
}

async function callPresenceRpc(
  db: SupabaseClient,
  name:
    | "heartbeat_greenwood_presence"
    | "sit_greenwood_presence"
    | "leave_greenwood_presence",
  profileId: string,
): Promise<PresenceSelf> {
  const { data, error } = await db.rpc(name, { p_profile_id: profileId });
  if (error) {
    throw mapPresenceRpcError(error.message ?? "");
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | GreenwoodPresenceRpcRow
    | undefined;
  if (!row) {
    throw new GreenwoodError(
      "greenwood_presence_failed",
      "Fire presence RPC returned no row",
      500,
    );
  }
  return {
    present: isFirePresenceActive(row.last_seen_at),
    sitting: Boolean(row.sitting) && isFirePresenceActive(row.last_seen_at),
  };
}

/** Record a Fire heartbeat for a Greenwood member. Idempotent. */
export async function heartbeatFirePresence(
  profileId: string,
  admin?: SupabaseClient,
): Promise<PresenceSelf> {
  const id = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());
  return callPresenceRpc(db, "heartbeat_greenwood_presence", id);
}

/** Explicitly sit by The Fire. Idempotent. */
export async function sitByTheFire(
  profileId: string,
  admin?: SupabaseClient,
): Promise<PresenceSelf> {
  const id = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());
  return callPresenceRpc(db, "sit_greenwood_presence", id);
}

/** Stop sitting by The Fire. Idempotent. Remains present if heartbeats continue. */
export async function leaveTheFire(
  profileId: string,
  admin?: SupabaseClient,
): Promise<PresenceSelf> {
  const id = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());
  return callPresenceRpc(db, "leave_greenwood_presence", id);
}

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

type SigilJoinRow = {
  profile_id: string;
  greenwood_sigil_catalogue: {
    slug: string;
    ascii_body: string;
    a11y_label: string;
    width: number | string;
    height: number | string;
    is_fallback: boolean;
  } | null;
};

function toSafeSigil(raw: {
  slug: string;
  ascii_body: string;
  a11y_label: string;
  width: number | string;
  height: number | string;
  is_fallback: boolean;
}): SafeGreenwoodSigil {
  return {
    slug: raw.slug,
    asciiBody: raw.ascii_body,
    a11yLabel: raw.a11y_label,
    width: assertSafeIntegerAmount(raw.width, "width", "UNSAFE_BIGINT"),
    height: assertSafeIntegerAmount(raw.height, "height", "UNSAFE_BIGINT"),
    isFallback: Boolean(raw.is_fallback),
  };
}

/**
 * Active Fire presence for Greenwood members only.
 * Expired heartbeats are omitted even when sitting=true.
 * Viewer must already be verified as a Greenwood member by the route.
 */
export async function getFirePresenceSnapshot(
  viewerProfileId: string,
  admin?: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<FirePresenceSnapshot> {
  const viewerId = assertProfileId(viewerProfileId);
  const db = admin ?? (await defaultAdmin());

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
    throw new GreenwoodError(
      "greenwood_presence_failed",
      "Failed to load Fire presence",
      500,
    );
  }

  const rows = (data ?? []) as unknown as PresenceJoinRow[];
  const activeRows = rows.filter((row) => {
    const profile = row.profiles;
    if (!profile || profile.greenwood_entered_at == null) return false;
    return isFirePresenceActive(row.last_seen_at, nowMs);
  });

  const sigilByProfile = new Map<string, SafeGreenwoodSigil>();
  if (activeRows.length > 0) {
    const ids = activeRows.map((row) => row.profile_id);
    const { data: sigilRows, error: sigilError } = await db
      .from("greenwood_sigil_assignments")
      .select(PRESENCE_CURRENT_SIGIL_SELECT)
      .in("profile_id", ids);

    if (sigilError) {
      const diagnostics = {
        operation: "loadFirePresence.sigils",
        code: sigilError.code,
        message: sigilError.message,
        details: sigilError.details,
        hint: sigilError.hint,
      };
      console.error("[loadFirePresence] sigil embed failed", diagnostics);
      throw new GreenwoodError(
        "greenwood_presence_failed",
        "Failed to load Fire presence marks",
        500,
        { cause: diagnostics },
      );
    }

    for (const raw of (sigilRows ?? []) as unknown as SigilJoinRow[]) {
      if (raw.greenwood_sigil_catalogue) {
        sigilByProfile.set(raw.profile_id, toSafeSigil(raw.greenwood_sigil_catalogue));
      }
    }
  }

  const built: Array<FirePresenceMember & { outlawNumber: number }> = [];

  for (const row of activeRows) {
    const profile = row.profiles;
    if (!profile) continue;

    const outlawNumber = assertSafeIntegerAmount(
      profile.outlaw_number,
      "outlaw_number",
      "UNSAFE_BIGINT",
    );
    const outlawLabel = `OUTLAW ${formatOutlawNumber(outlawNumber)}`;
    const alias = profile.alias?.trim() || null;

    built.push({
      outlawLabel,
      displayName: alias ?? outlawLabel,
      sigil: sigilByProfile.get(row.profile_id) ?? null,
      sitting: Boolean(row.sitting),
      isSelf: row.profile_id === viewerId,
      outlawNumber,
    });
  }

  built.sort(compareFirePresenceMembers);

  const members: FirePresenceMember[] = built.map((entry) => ({
    outlawLabel: entry.outlawLabel,
    displayName: entry.displayName,
    sigil: entry.sigil,
    sitting: entry.sitting,
    isSelf: entry.isSelf,
  }));

  const selfRow = built.find((m) => m.isSelf) ?? null;

  return {
    self: {
      present: selfRow != null,
      sitting: selfRow?.sitting ?? false,
    },
    activeCount: members.length,
    members,
  };
}

/**
 * Assert the profile is a Greenwood member (for GET route gating before list).
 */
export async function assertProfileIsGreenwoodMember(
  profileId: string,
  admin?: SupabaseClient,
): Promise<void> {
  const id = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("profiles")
    .select("greenwood_entered_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new GreenwoodError(
      "greenwood_presence_failed",
      "Failed to verify Greenwood membership",
      500,
    );
  }
  if (!data) {
    throw new GreenwoodError(
      "greenwood_presence_failed",
      "Profile not found for Fire presence",
      404,
    );
  }
  if (
    (data as { greenwood_entered_at: string | null }).greenwood_entered_at ==
    null
  ) {
    throw new GreenwoodError(
      "greenwood_membership_required",
      "Greenwood membership required for Fire presence",
      403,
    );
  }
}
