import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { GreenwoodError } from "@/lib/greenwood/errors";
import type {
  AdmitToGreenwoodRpcRow,
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
 * Idempotent: already_member is a successful permanent-member outcome.
 */
export async function admitProfileToGreenwood(
  profileId: string,
  admin?: SupabaseClient,
): Promise<GreenwoodAdmissionResult> {
  const id = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { data, error } = await db.rpc("admit_to_greenwood", {
    p_profile_id: id,
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

  return normalizeAdmitRpcRow(row);
}

export function normalizeAdmitRpcRow(
  row: AdmitToGreenwoodRpcRow,
): GreenwoodAdmissionResult {
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

    return {
      status,
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
