import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  evaluateCreateDeedSubmission,
  isDeedUuid,
  ownDeedSubmissionFilters,
} from "@/lib/deeds/submission-evaluate";
import { toSafeDeedSubmission } from "@/lib/deeds/submission-dto";
import { toSafeDeed } from "@/lib/deeds/rules";
import type {
  DeedRow,
  DeedSubmissionErrorCode,
  DeedSubmissionEvidenceInput,
  DeedSubmissionRow,
  SafeDeed,
  SafeDeedSubmission,
} from "@/lib/deeds/types";
import { createAdminClient } from "@/lib/supabase/admin";

const DEED_SELECT =
  "id, slug, title, lore_description, instructions, category, access_scope, status, reward_leaf_fixed, reward_leaf_min, reward_leaf_max, evidence_requirements, starts_at, ends_at, max_completions, completions_count, is_public, is_repeatable, sponsor_name, external_reward_note, published_at";

const SUBMISSION_SELECT =
  "id, deed_id, profile_id, status, evidence_text, evidence_url, evidence_image_path, evidence_other, submitted_at, reviewed_at, review_note, leaf_awarded";

export class DeedSubmissionError extends Error {
  code: DeedSubmissionErrorCode;
  status: number;
  evidenceErrors?: unknown;

  constructor(
    code: DeedSubmissionErrorCode,
    message: string,
    status = 400,
    evidenceErrors?: unknown,
  ) {
    super(message);
    this.name = "DeedSubmissionError";
    this.code = code;
    this.status = status;
    this.evidenceErrors = evidenceErrors;
  }
}

export function assertDeedId(deedId: string): string {
  const trimmed = deedId.trim();
  if (!isDeedUuid(trimmed)) {
    throw new DeedSubmissionError("invalid_deed_id", "Invalid deed id", 400);
  }
  return trimmed;
}

async function loadDeedById(
  admin: SupabaseClient,
  deedId: string,
): Promise<SafeDeed | null> {
  const { data, error } = await admin
    .from("deeds")
    .select(DEED_SELECT)
    .eq("id", deedId)
    .maybeSingle();

  if (error) {
    throw new DeedSubmissionError(
      "write_failed",
      "Failed to load deed",
      500,
    );
  }
  if (!data) return null;
  return toSafeDeed(data as DeedRow);
}

/**
 * Own-history only. Always filter by verified profileId — never trust the client.
 */
export async function getMySubmissionsForDeed(
  profileId: string,
  deedId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<SafeDeedSubmission[]> {
  let filters: { profile_id: string; deed_id: string };
  try {
    filters = ownDeedSubmissionFilters(profileId, deedId);
  } catch {
    throw new DeedSubmissionError(
      !profileId.trim() ? "not_registered" : "invalid_deed_id",
      !profileId.trim() ? "Profile required" : "Invalid deed id",
      !profileId.trim() ? 403 : 400,
    );
  }
  const { data, error } = await admin
    .from("deed_submissions")
    .select(SUBMISSION_SELECT)
    .eq("deed_id", filters.deed_id)
    .eq("profile_id", filters.profile_id)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw new DeedSubmissionError(
      "write_failed",
      "Failed to load submissions",
      500,
    );
  }

  return ((data ?? []) as DeedSubmissionRow[]).map(toSafeDeedSubmission);
}

export async function listMyDeedSubmissions(
  profileId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<SafeDeedSubmission[]> {
  const { data, error } = await admin
    .from("deed_submissions")
    .select(SUBMISSION_SELECT)
    .eq("profile_id", profileId)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw new DeedSubmissionError(
      "write_failed",
      "Failed to load submissions",
      500,
    );
  }

  return ((data ?? []) as DeedSubmissionRow[]).map(toSafeDeedSubmission);
}

export type CreateDeedSubmissionInput = {
  profileId: string;
  deedId: string;
  evidence: DeedSubmissionEvidenceInput;
  now?: Date;
};

/**
 * Canonical pending submission write.
 * profileId must come from verified server identity — never the request body.
 */
export async function createDeedSubmission(
  input: CreateDeedSubmissionInput,
  admin: SupabaseClient = createAdminClient(),
): Promise<SafeDeedSubmission> {
  const deedId = assertDeedId(input.deedId);
  const deed = await loadDeedById(admin, deedId);
  const existing = await getMySubmissionsForDeed(input.profileId, deedId, admin);

  const gate = evaluateCreateDeedSubmission({
    deed,
    existingSubmissions: existing.map((s) => ({ status: s.status })),
    evidence: input.evidence,
    now: input.now,
  });

  if (!gate.ok) {
    const status =
      gate.code === "deed_not_found"
        ? 404
        : gate.code === "greenwood_not_available_yet" ||
            gate.code === "common_not_available_yet" ||
            gate.code === "submission_already_pending" ||
            gate.code === "non_repeatable_complete"
          ? 403
          : 400;

    throw new DeedSubmissionError(
      gate.code,
      messageForCode(gate.code),
      status,
      gate.evidenceErrors,
    );
  }

  const { evidence } = gate;

  const { data, error } = await admin
    .from("deed_submissions")
    .insert({
      deed_id: deedId,
      profile_id: input.profileId,
      status: "pending",
      evidence_text: evidence.text,
      evidence_url: evidence.url,
      evidence_image_path: null,
      evidence_other: evidence.other,
    })
    .select(SUBMISSION_SELECT)
    .single();

  if (error) {
    // Partial unique index: one pending per (deed_id, profile_id)
    if (error.code === "23505") {
      throw new DeedSubmissionError(
        "submission_already_pending",
        messageForCode("submission_already_pending"),
        403,
      );
    }
    throw new DeedSubmissionError(
      "write_failed",
      "Failed to leave proof",
      500,
    );
  }

  const submission = toSafeDeedSubmission(data as DeedSubmissionRow);
  if (submission.status !== "pending") {
    // Defensive — insert always forces pending; never trust alternate status.
    throw new DeedSubmissionError(
      "write_failed",
      "Unexpected submission status",
      500,
    );
  }

  return submission;
}

function messageForCode(code: DeedSubmissionErrorCode): string {
  switch (code) {
    case "deed_not_found":
      return "Deed not found";
    case "deed_not_open":
      return "This work is no longer being taken";
    case "greenwood_not_available_yet":
      return "This work begins beyond the gate";
    case "common_not_available_yet":
      return "This work is not yet open on the road";
    case "image_evidence_unavailable":
      return "This deed asks for proof the board cannot yet receive";
    case "invalid_evidence":
      return "The proof does not meet the notice";
    case "invalid_requirements":
      return "This deed's proof requirements are unclear";
    case "submission_already_pending":
      return "Proof has already been left";
    case "non_repeatable_complete":
      return "This deed has already been completed";
    case "not_registered":
      return "A name must be entered in the book first";
    case "invalid_deed_id":
      return "Invalid deed id";
    case "invalid_json":
      return "Invalid request";
    case "write_failed":
      return "Failed to leave proof";
  }
}
