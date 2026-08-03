import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { DeedAuthoringError } from "@/lib/deeds/authoring-validation";
import { writeFennWallEntry } from "@/lib/wall/write";
import { WallError } from "@/lib/wall/errors";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";
import type { PublicWallEntry } from "@/lib/wall/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DeedSubmissionWallShare = {
  shared: boolean;
  wallEntryId: string | null;
  wallPath: string | null;
};

export type ShareDeedSubmissionToWallResult = {
  created: boolean;
  wallShare: DeedSubmissionWallShare;
  entry: PublicWallEntry;
};

export function deedSubmissionWallSourceExternalId(submissionId: string): string {
  return `deed_submission:${submissionId}:wall`;
}

function assertSubmissionId(id: string): string {
  const value = id.trim();
  if (!UUID_RE.test(value)) {
    throw new DeedAuthoringError("invalid_id", "Invalid submission id", 400);
  }
  return value;
}

function validatePublicInscriptionBody(body: string): string {
  if (typeof body !== "string") {
    throw new DeedAuthoringError("invalid_body", "body must be a string", 422);
  }
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new DeedAuthoringError("invalid_body", "body is required", 422);
  }
  if (trimmed.length > WALL_BODY_MAX_CHARS) {
    throw new DeedAuthoringError(
      "invalid_body",
      `body must be at most ${WALL_BODY_MAX_CHARS} characters`,
      422,
    );
  }
  // Reject obvious HTML payloads; wall is plain text.
  if (/[<>]/.test(trimmed)) {
    throw new DeedAuthoringError(
      "invalid_body",
      "body must not contain HTML markup",
      422,
    );
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (
      code === 0x7f ||
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)
    ) {
      throw new DeedAuthoringError(
        "invalid_body",
        "body contains invalid control characters",
        422,
      );
    }
  }
  return trimmed;
}

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function wallShareFromId(wallEntryId: string | null): DeedSubmissionWallShare {
  if (!wallEntryId) {
    return { shared: false, wallEntryId: null, wallPath: null };
  }
  return {
    shared: true,
    wallEntryId,
    wallPath: "/wall",
  };
}

function isMissingWallEntryColumn(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    error.code === "42703" ||
    Boolean(
      error.message?.includes("wall_entry_id") &&
        error.message?.toLowerCase().includes("does not exist"),
    )
  );
}

/**
 * Deliberate Desk-only share of an approved submission onto the Wall.
 * Does not award LEAF. Does not change approval status. Does not auto-run from approval.
 */
export async function shareApprovedSubmissionToWall(input: {
  submissionId: string;
  body: string;
  actorId: string;
  admin?: SupabaseClient;
}): Promise<ShareDeedSubmissionToWallResult> {
  const submissionId = assertSubmissionId(input.submissionId);
  const body = validatePublicInscriptionBody(input.body);
  const db = input.admin ?? (await defaultAdmin());

  const { data: subRow, error: subError } = await db
    .from("deed_submissions")
    .select("id, deed_id, profile_id, status, leaf_awarded, wall_entry_id")
    .eq("id", submissionId)
    .maybeSingle();

  if (subError) {
    if (isMissingWallEntryColumn(subError)) {
      throw new DeedAuthoringError(
        "schema_not_ready",
        "Wall link is not available until the deed submission Wall migration is applied",
        503,
      );
    }
    throw new DeedAuthoringError("read_failed", "Failed to load submission", 500);
  }
  if (!subRow) {
    throw new DeedAuthoringError("not_found", "Submission not found", 404);
  }

  const submission = subRow as {
    id: string;
    deed_id: string;
    profile_id: string;
    status: string;
    leaf_awarded: number | null;
    wall_entry_id: string | null;
  };

  if (submission.status === "pending") {
    throw new DeedAuthoringError(
      "not_approved",
      "Only approved submissions can be shared to the Wall",
      409,
    );
  }
  if (submission.status === "rejected") {
    throw new DeedAuthoringError(
      "not_approved",
      "Rejected submissions cannot be shared to the Wall",
      409,
    );
  }
  if (submission.status !== "approved") {
    throw new DeedAuthoringError(
      "not_approved",
      "Only approved submissions can be shared to the Wall",
      409,
    );
  }

  if (submission.wall_entry_id) {
    return {
      created: false,
      wallShare: wallShareFromId(submission.wall_entry_id),
      entry: {
        id: submission.wall_entry_id,
        body,
        createdAt: new Date(0).toISOString(),
        markCount: 0,
      },
    };
  }

  const { data: deedRow, error: deedError } = await db
    .from("deeds")
    .select("id, title, slug")
    .eq("id", submission.deed_id)
    .maybeSingle();
  if (deedError) {
    throw new DeedAuthoringError("read_failed", "Failed to load deed", 500);
  }
  if (!deedRow) {
    throw new DeedAuthoringError("not_found", "Related deed not found", 404);
  }

  const { data: profileRow, error: profileError } = await db
    .from("profiles")
    .select("id")
    .eq("id", submission.profile_id)
    .maybeSingle();
  if (profileError) {
    throw new DeedAuthoringError("read_failed", "Failed to load profile", 500);
  }
  if (!profileRow) {
    throw new DeedAuthoringError("not_found", "Related profile not found", 404);
  }

  let wallResult;
  try {
    wallResult = await writeFennWallEntry(
      {
        body,
        sourceType: "system",
        sourceExternalId: deedSubmissionWallSourceExternalId(submissionId),
      },
      db,
    );
  } catch (error) {
    if (error instanceof WallError) {
      throw new DeedAuthoringError(error.code, error.message, error.status);
    }
    throw error;
  }

  const { data: linked, error: linkError } = await db
    .from("deed_submissions")
    .update({ wall_entry_id: wallResult.entry.id })
    .eq("id", submissionId)
    .eq("status", "approved")
    .is("wall_entry_id", null)
    .select("id, wall_entry_id")
    .maybeSingle();

  async function readPersistedWallEntryId(): Promise<string | null> {
    const { data: reloaded } = await db
      .from("deed_submissions")
      .select("wall_entry_id")
      .eq("id", submissionId)
      .maybeSingle();
    return (
      (reloaded as { wall_entry_id: string | null } | null)?.wall_entry_id ??
      null
    );
  }

  let wallEntryId =
    (linked as { wall_entry_id: string | null } | null)?.wall_entry_id ?? null;

  if (linkError || !wallEntryId) {
    // Race, unique on wall_entry_id, or 0-row update — re-read first.
    wallEntryId = await readPersistedWallEntryId();
  }

  if (!wallEntryId) {
    // Recovery: provenance write succeeded; retry conditional link once.
    const { data: retry } = await db
      .from("deed_submissions")
      .update({ wall_entry_id: wallResult.entry.id })
      .eq("id", submissionId)
      .eq("status", "approved")
      .is("wall_entry_id", null)
      .select("id, wall_entry_id")
      .maybeSingle();
    wallEntryId =
      (retry as { wall_entry_id: string | null } | null)?.wall_entry_id ??
      (await readPersistedWallEntryId());
  }

  if (!wallEntryId) {
    // Do not report success if the submission is still unlinked.
    // writeFennWallEntry is idempotent on provenance, so a later retry will
    // reuse the same entry and complete the link.
    throw new DeedAuthoringError(
      "write_failed",
      "Wall inscription was written but could not be linked to the submission. Retry.",
      500,
    );
  }

  if (wallResult.created) {
    const deed = deedRow as { id: string; title: string; slug: string | null };
    await writeAdminAuditLog(db, {
      actorId: input.actorId,
      action: "deed.submission.share_to_wall",
      entityType: "deed_submission",
      entityId: submissionId,
      afterState: {
        deedId: deed.id,
        profileId: submission.profile_id,
        wallEntryId,
        leafAwarded: submission.leaf_awarded,
        wallCreated: wallResult.created,
      },
      reason: "Desk shared approved Deed submission to the Wall",
    });
  }

  return {
    // created reflects Wall entry creation; link is guaranteed when success returns.
    created: wallResult.created,
    wallShare: wallShareFromId(wallEntryId),
    entry: wallResult.entry,
  };
}
