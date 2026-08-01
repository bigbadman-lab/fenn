import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { GreenwoodError } from "@/lib/greenwood/errors";
import type {
  AssignGreenwoodSigilRpcRow,
  GreenwoodSigilAssignmentResult,
  SafeGreenwoodSigil,
} from "@/lib/greenwood/sigil/types";
import { assertProfileId, assertSafeIntegerAmount } from "@/lib/leaf/validate";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function toSafeSigil(row: {
  slug: string;
  ascii_body: string;
  a11y_label: string;
  width: number | string;
  height: number | string;
  is_fallback: boolean;
}): SafeGreenwoodSigil {
  return {
    slug: row.slug,
    asciiBody: row.ascii_body,
    a11yLabel: row.a11y_label,
    width: assertSafeIntegerAmount(row.width, "width", "UNSAFE_BIGINT"),
    height: assertSafeIntegerAmount(row.height, "height", "UNSAFE_BIGINT"),
    isFallback: Boolean(row.is_fallback),
  };
}

export function normalizeAssignRpcRow(
  row: AssignGreenwoodSigilRpcRow,
): GreenwoodSigilAssignmentResult {
  const safe = toSafeSigil(row);
  return {
    ...safe,
    profileId: assertProfileId(row.profile_id),
    sigilId: assertProfileId(row.sigil_id),
    newlyAssigned: Boolean(row.newly_assigned),
    assignedAt: row.assigned_at,
  };
}

/**
 * Read the active sigil for a profile, or null if none assigned.
 * Does not assign. Service-role only.
 */
export async function getProfileSigil(
  profileId: string,
  admin?: SupabaseClient,
): Promise<SafeGreenwoodSigil | null> {
  const id = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { data, error } = await db
    .from("greenwood_sigil_assignments")
    .select(
      "sigil_id, greenwood_sigil_catalogue ( slug, ascii_body, a11y_label, width, height, is_fallback )",
    )
    .eq("profile_id", id)
    .maybeSingle();

  if (error) {
    throw new GreenwoodError(
      "greenwood_sigil_failed",
      "Failed to load Greenwood sigil",
      500,
    );
  }
  if (!data) return null;

  const catalogue = (
    data as {
      greenwood_sigil_catalogue:
        | {
            slug: string;
            ascii_body: string;
            a11y_label: string;
            width: number | string;
            height: number | string;
            is_fallback: boolean;
          }
        | {
            slug: string;
            ascii_body: string;
            a11y_label: string;
            width: number | string;
            height: number | string;
            is_fallback: boolean;
          }[]
        | null;
    }
  ).greenwood_sigil_catalogue;

  const row = Array.isArray(catalogue) ? catalogue[0] : catalogue;
  if (!row) return null;
  return toSafeSigil(row);
}

/**
 * Idempotent assignment via public.assign_greenwood_sigil.
 * Profile must already be a Greenwood member.
 * Next unused curated mark by sort_order, then id.
 * UNMARKED only when the curated pool is exhausted.
 */
export async function assignGreenwoodSigil(
  profileId: string,
  assignedBy: string = "system",
  admin?: SupabaseClient,
): Promise<GreenwoodSigilAssignmentResult> {
  const id = assertProfileId(profileId);
  const db = admin ?? (await defaultAdmin());

  const { data, error } = await db.rpc("assign_greenwood_sigil", {
    p_profile_id: id,
    p_assigned_by: assignedBy,
  });

  if (error) {
    throw mapAssignRpcError(error.message ?? "");
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | AssignGreenwoodSigilRpcRow
    | undefined;

  if (!row) {
    throw new GreenwoodError(
      "greenwood_sigil_failed",
      "Greenwood sigil assignment returned no row",
      500,
    );
  }

  return normalizeAssignRpcRow(row);
}

/**
 * Ensure a Greenwood member has exactly one sigil.
 * Idempotent: returns the existing assignment when present.
 */
export async function ensureMemberSigil(
  profileId: string,
  assignedBy: string = "system",
  admin?: SupabaseClient,
): Promise<GreenwoodSigilAssignmentResult> {
  return assignGreenwoodSigil(profileId, assignedBy, admin);
}

/**
 * Deterministic backfill for members missing assignments.
 * Member order (DB): outlaw_number ASC, greenwood_entered_at ASC, id ASC.
 * Sigil order: catalogue.sort_order ASC, catalogue.id ASC.
 */
export async function backfillGreenwoodSigils(
  admin?: SupabaseClient,
): Promise<{
  processed: number;
  newlyAssigned: number;
  unmarkedAssigned: number;
}> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db.rpc("backfill_greenwood_sigils");

  if (error) {
    throw new GreenwoodError(
      "greenwood_sigil_failed",
      "Greenwood sigil backfill failed",
      500,
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        processed: number | string;
        newly_assigned: number | string;
        unmarked_assigned: number | string;
      }
    | undefined;

  if (!row) {
    return { processed: 0, newlyAssigned: 0, unmarkedAssigned: 0 };
  }

  return {
    processed: assertSafeIntegerAmount(
      row.processed,
      "processed",
      "UNSAFE_BIGINT",
    ),
    newlyAssigned: assertSafeIntegerAmount(
      row.newly_assigned,
      "newly_assigned",
      "UNSAFE_BIGINT",
    ),
    unmarkedAssigned: assertSafeIntegerAmount(
      row.unmarked_assigned,
      "unmarked_assigned",
      "UNSAFE_BIGINT",
    ),
  };
}

function mapAssignRpcError(message: string): GreenwoodError {
  if (message.includes("FENN_PROFILE_NOT_FOUND")) {
    return new GreenwoodError(
      "greenwood_sigil_failed",
      "Profile not found for sigil assignment",
      404,
    );
  }
  if (message.includes("FENN_GREENWOOD_MEMBERSHIP_REQUIRED")) {
    return new GreenwoodError(
      "greenwood_membership_required",
      "Greenwood membership required for sigil assignment",
      403,
    );
  }
  if (message.includes("FENN_GREENWOOD_SIGIL_FALLBACK_MISSING")) {
    return new GreenwoodError(
      "greenwood_sigil_failed",
      "UNMARKED fallback sigil is not configured",
      503,
    );
  }
  if (message.includes("FENN_VALIDATION")) {
    return new GreenwoodError(
      "greenwood_sigil_failed",
      "Greenwood sigil validation failed",
      400,
    );
  }
  return new GreenwoodError(
    "greenwood_sigil_failed",
    "Greenwood sigil assignment failed",
    500,
  );
}
