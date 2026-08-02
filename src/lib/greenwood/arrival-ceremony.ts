import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { GreenwoodError } from "@/lib/greenwood/errors";
import { assertProfileId } from "@/lib/leaf/validate";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export type ArrivalCeremonyCompleteStatus =
  | "completed"
  | "already_completed"
  | "not_member";

export type ArrivalCeremonyCompleteResult = {
  status: ArrivalCeremonyCompleteStatus;
  completedAt: string | null;
};

type CompleteRpcRow = {
  status: string;
  completed_at: string | null;
};

/**
 * Whether a Greenwood member still needs the one-time arrival ceremony.
 * Non-members are never pending.
 */
export async function isArrivalCeremonyPending(
  profileId: string,
  admin?: SupabaseClient,
): Promise<boolean> {
  const id = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { data, error } = await db
    .from("profiles")
    .select(
      "greenwood_entered_at, greenwood_arrival_ceremony_completed_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new GreenwoodError(
      "greenwood_status_failed",
      "Failed to load arrival ceremony state",
      500,
    );
  }
  if (!data) {
    throw new GreenwoodError(
      "greenwood_status_failed",
      "Profile not found",
      404,
    );
  }

  const row = data as {
    greenwood_entered_at: string | null;
    greenwood_arrival_ceremony_completed_at: string | null;
  };

  return (
    row.greenwood_entered_at != null &&
    row.greenwood_arrival_ceremony_completed_at == null
  );
}

/**
 * Idempotent durable completion of the first Greenwood arrival ceremony.
 * Does not alter membership or the admission triad.
 */
export async function completeGreenwoodArrivalCeremony(
  profileId: string,
  admin?: SupabaseClient,
): Promise<ArrivalCeremonyCompleteResult> {
  const id = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { data, error } = await db.rpc("complete_greenwood_arrival_ceremony", {
    p_profile_id: id,
  });

  if (error) {
    if ((error.message ?? "").includes("FENN_PROFILE_NOT_FOUND")) {
      throw new GreenwoodError(
        "greenwood_admission_failed",
        "Profile not found",
        404,
      );
    }
    throw new GreenwoodError(
      "greenwood_status_failed",
      "Failed to complete arrival ceremony",
      500,
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | CompleteRpcRow
    | undefined;

  if (!row) {
    throw new GreenwoodError(
      "greenwood_status_failed",
      "Arrival ceremony RPC returned no row",
      500,
    );
  }

  const status = String(row.status ?? "");
  if (
    status !== "completed" &&
    status !== "already_completed" &&
    status !== "not_member"
  ) {
    throw new GreenwoodError(
      "greenwood_status_failed",
      "Arrival ceremony RPC returned unknown status",
      500,
    );
  }

  return {
    status,
    completedAt: row.completed_at,
  };
}
