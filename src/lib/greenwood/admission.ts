import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { profileHasGreenwoodAccessOverride } from "@/lib/greenwood/access-wallets";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { ensureMemberSigil } from "@/lib/greenwood/sigil/assignment";
import type { SafeGreenwoodSigil } from "@/lib/greenwood/sigil/types";
import type {
  AdmitToGreenwoodRpcRow,
  GreenwoodAdmissionNotEligible,
  GreenwoodAdmissionResult,
} from "@/lib/greenwood/types";
import { assertProfileId, assertSafeIntegerAmount } from "@/lib/leaf/validate";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Admit a registered profile via Stage 8.1 public.admit_to_greenwood.
 * Passes only the trusted server-resolved profile ID.
 * Access override is derived from the profile's stored wallet vs
 * GREENWOOD_ACCESS_WALLETS — never from client input.
 * Idempotent: already_member is a successful permanent-member outcome.
 * Awards/spends zero LEAF.
 */
export async function admitProfileToGreenwood(
  profileId: string,
  admin?: SupabaseClient,
): Promise<GreenwoodAdmissionResult> {
  const id = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { data: profileRow, error: profileError } = await db
    .from("profiles")
    .select("wallet_address")
    .eq("id", id)
    .maybeSingle();

  if (profileError) {
    throw new GreenwoodError(
      "greenwood_admission_failed",
      "Failed to load profile for Greenwood admission",
      500,
    );
  }
  if (!profileRow) {
    throw new GreenwoodError(
      "greenwood_admission_failed",
      "Profile not found for Greenwood admission",
      404,
    );
  }

  const accessOverride = profileHasGreenwoodAccessOverride(
    String((profileRow as { wallet_address: string }).wallet_address ?? ""),
  );

  const { data, error } = await db.rpc("admit_to_greenwood", {
    p_profile_id: id,
    p_access_override: accessOverride,
  });

  if (error) {
    throw mapAdmitRpcError(error.message ?? "");
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | AdmitToGreenwoodRpcRow
    | undefined;

  if (!row) {
    throw new GreenwoodError(
      "greenwood_admission_failed",
      "Greenwood admission RPC returned no row",
      500,
    );
  }

  const result = normalizeAdmitRpcRow(row);

  if (result.status === "admitted") {
    const sigil = await tryEnsureSigilAfterAdmission(
      id,
      "system_admit",
      db,
    );
    return { ...result, sigil, arrivalCeremonyPending: true };
  }

  if (result.status === "already_member") {
    const sigil = await tryEnsureSigilAfterAdmission(
      id,
      "system_ensure",
      db,
    );
    const pending = await loadArrivalCeremonyPending(id, db);
    return { ...result, sigil, arrivalCeremonyPending: pending };
  }

  return result;
}

async function loadArrivalCeremonyPending(
  profileId: string,
  db: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await db
    .from("profiles")
    .select("greenwood_arrival_ceremony_completed_at")
    .eq("id", profileId)
    .maybeSingle();

  if (error || !data) {
    // Fail closed toward showing the ceremony only when durable state is unknown
    // for an already-member path; prefer not inventing completion.
    console.error(
      "[admitProfileToGreenwood] arrival ceremony state load failed",
      { profileId, error },
    );
    return true;
  }

  return (
    (data as { greenwood_arrival_ceremony_completed_at: string | null })
      .greenwood_arrival_ceremony_completed_at == null
  );
}

/**
 * Sigil assignment must not undo a successful admission.
 * Failures are logged for ops; membership remains valid.
 */
async function tryEnsureSigilAfterAdmission(
  profileId: string,
  assignedBy: string,
  db: SupabaseClient,
): Promise<SafeGreenwoodSigil | null> {
  try {
    const assigned = await ensureMemberSigil(profileId, assignedBy, db);
    return {
      slug: assigned.slug,
      asciiBody: assigned.asciiBody,
      a11yLabel: assigned.a11yLabel,
      width: assigned.width,
      height: assigned.height,
      isFallback: assigned.isFallback,
    };
  } catch (err) {
    console.error(
      "[admitProfileToGreenwood] sigil assignment failed after admission",
      { profileId, assignedBy, err },
    );
    return null;
  }
}

/** RPC membership row before ceremony/sigil enrichment. */
export type NormalizedAdmitRpcResult =
  | {
      status: "admitted";
      greenwoodEnteredAt: string;
      thresholdAtEntry: number;
      lifetimeLeafAtEntry: number;
    }
  | {
      status: "already_member";
      greenwoodEnteredAt: string;
      thresholdAtEntry: number;
      lifetimeLeafAtEntry: number;
    }
  | GreenwoodAdmissionNotEligible;

export function normalizeAdmitRpcRow(
  row: AdmitToGreenwoodRpcRow,
): NormalizedAdmitRpcResult {
  const status = String(row.status ?? "");

  if (status === "not_eligible") {
    const lifetimeLeaf = assertSafeIntegerAmount(
      row.lifetime_leaf,
      "lifetime_leaf",
      "UNSAFE_BIGINT",
    );
    const threshold = assertSafeIntegerAmount(
      row.threshold,
      "threshold",
      "UNSAFE_BIGINT",
    );
    return {
      status: "not_eligible",
      lifetimeLeaf,
      threshold,
      remainingLeaf: Math.max(0, threshold - lifetimeLeaf),
    };
  }

  if (status === "admitted" || status === "already_member") {
    if (
      !row.greenwood_entered_at ||
      row.greenwood_threshold_at_entry == null ||
      row.greenwood_lifetime_leaf_at_entry == null
    ) {
      throw new GreenwoodError(
        "greenwood_admission_failed",
        "Greenwood admission RPC returned incomplete membership",
        500,
      );
    }

    const membership = {
      greenwoodEnteredAt: row.greenwood_entered_at,
      thresholdAtEntry: assertSafeIntegerAmount(
        row.greenwood_threshold_at_entry,
        "greenwood_threshold_at_entry",
        "UNSAFE_BIGINT",
      ),
      lifetimeLeafAtEntry: assertSafeIntegerAmount(
        row.greenwood_lifetime_leaf_at_entry,
        "greenwood_lifetime_leaf_at_entry",
        "UNSAFE_BIGINT",
      ),
    };
    if (status === "admitted") {
      return { status: "admitted", ...membership };
    }
    return { status: "already_member", ...membership };
  }

  throw new GreenwoodError(
    "greenwood_admission_failed",
    "Greenwood admission RPC returned unknown status",
    500,
  );
}

function mapAdmitRpcError(message: string): GreenwoodError {
  if (message.includes("FENN_PROFILE_NOT_FOUND")) {
    return new GreenwoodError(
      "greenwood_admission_failed",
      "Profile not found for Greenwood admission",
      404,
    );
  }
  if (
    message.includes("FENN_GREENWOOD_THRESHOLD_MISSING") ||
    message.includes("FENN_GREENWOOD_THRESHOLD_INVALID")
  ) {
    return new GreenwoodError(
      "greenwood_configuration_error",
      "Greenwood threshold is not configured",
      503,
    );
  }
  if (message.includes("FENN_VALIDATION")) {
    return new GreenwoodError(
      "greenwood_admission_failed",
      "Greenwood admission validation failed",
      400,
    );
  }
  return new GreenwoodError(
    "greenwood_admission_failed",
    "Greenwood admission failed",
    500,
  );
}
