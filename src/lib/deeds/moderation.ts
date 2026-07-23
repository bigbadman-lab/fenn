import "server-only";

import type { FennAdminIdentity } from "@/lib/admin/auth";
import { formatDeedReward } from "@/lib/deeds/format";
import {
  approveDeedSubmissionAtomic,
  rejectDeedSubmissionAtomic,
} from "@/lib/deeds/moderation-rpc";
import { DeedModerationRpcError } from "@/lib/deeds/moderation-rpc-errors";
import { toSafeDeed } from "@/lib/deeds/rules";
import type {
  DeedReward,
  DeedRow,
  DeedSubmissionRow,
  SafeDeed,
} from "@/lib/deeds/types";
import {
  createDeedEvidenceSignedUrl,
  DeedImageError,
} from "@/lib/deeds/image-upload";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatOutlawNumber } from "@/lib/profiles/types";

const SUBMISSION_SELECT =
  "id, deed_id, profile_id, status, evidence_text, evidence_url, evidence_image_path, evidence_other, submitted_at, reviewed_at, review_note, leaf_awarded, leaf_ledger_id";

const DEED_SELECT =
  "id, slug, title, lore_description, instructions, category, access_scope, status, reward_leaf_fixed, reward_leaf_min, reward_leaf_max, evidence_requirements, starts_at, ends_at, max_completions, completions_count, is_public, is_repeatable, sponsor_name, external_reward_note, published_at";

export type ModerationQueueItem = {
  submissionId: string;
  deedId: string;
  deedTitle: string;
  deedSlug: string | null;
  reward: DeedReward;
  rewardLabel: string;
  outlawNumber: number;
  outlawLabel: string;
  submittedAt: string;
  evidenceText: string | null;
  evidenceUrl: string | null;
  evidenceOther: string | null;
  hasImageEvidence: boolean;
  isRepeatable: boolean;
};

export type ModerationDetail = ModerationQueueItem & {
  status: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  leafAwarded: number | null;
  evidenceRequirements: SafeDeed["evidenceRequirements"];
};

export class DeedModerationError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DeedModerationError";
    this.code = code;
    this.status = status;
  }
}

export async function listPendingDeedSubmissions(): Promise<
  ModerationQueueItem[]
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deed_submissions")
    .select(SUBMISSION_SELECT)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (error) {
    throw new DeedModerationError("queue_failed", "Failed to load queue", 500);
  }

  const rows = (data ?? []) as DeedSubmissionRow[];
  if (rows.length === 0) return [];

  const deedIds = [...new Set(rows.map((r) => r.deed_id))];
  const profileIds = [...new Set(rows.map((r) => r.profile_id))];

  const [{ data: deeds }, { data: profiles }] = await Promise.all([
    admin.from("deeds").select(DEED_SELECT).in("id", deedIds),
    admin
      .from("profiles")
      .select("id, outlaw_number, alias")
      .in("id", profileIds),
  ]);

  const deedMap = new Map(
    ((deeds ?? []) as DeedRow[]).map((d) => [d.id, toSafeDeed(d)]),
  );
  const profileMap = new Map(
    (
      (profiles ?? []) as Array<{
        id: string;
        outlaw_number: number;
        alias: string | null;
      }>
    ).map((p) => [p.id, p]),
  );

  return rows.flatMap((row) => {
    const deed = deedMap.get(row.deed_id);
    const profile = profileMap.get(row.profile_id);
    if (!deed || !profile) return [];
    return [toQueueItem(row, deed, profile.outlaw_number)];
  });
}

export async function getDeedSubmissionForModeration(
  submissionId: string,
): Promise<ModerationDetail | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deed_submissions")
    .select(SUBMISSION_SELECT)
    .eq("id", submissionId)
    .maybeSingle();

  if (error) {
    throw new DeedModerationError("read_failed", "Failed to load submission", 500);
  }
  if (!data) return null;

  const row = data as DeedSubmissionRow;
  const [{ data: deedRow }, { data: profile }] = await Promise.all([
    admin.from("deeds").select(DEED_SELECT).eq("id", row.deed_id).maybeSingle(),
    admin
      .from("profiles")
      .select("id, outlaw_number")
      .eq("id", row.profile_id)
      .maybeSingle(),
  ]);

  if (!deedRow || !profile) return null;
  const deed = toSafeDeed(deedRow as DeedRow);
  const base = toQueueItem(row, deed, profile.outlaw_number as number);

  return {
    ...base,
    status: row.status,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    leafAwarded: row.leaf_awarded,
    evidenceRequirements: deed.evidenceRequirements,
  };
}

export async function approveDeedSubmission(input: {
  submissionId: string;
  admin: FennAdminIdentity;
  leafAmount?: number | null;
  reviewNote?: string | null;
}) {
  try {
    return await approveDeedSubmissionAtomic({
      submissionId: input.submissionId,
      admin: input.admin,
      leafAmount: input.leafAmount,
      reviewNote: input.reviewNote,
    });
  } catch (error) {
    if (error instanceof DeedModerationRpcError) {
      throw new DeedModerationError(error.code, error.message, error.status);
    }
    throw error;
  }
}

export async function rejectDeedSubmission(input: {
  submissionId: string;
  admin: FennAdminIdentity;
  reviewNote: string;
}) {
  const note = input.reviewNote.trim();
  if (!note) {
    throw new DeedModerationError(
      "invalid_review_note",
      "Review note is required",
      422,
    );
  }

  try {
    return await rejectDeedSubmissionAtomic({
      submissionId: input.submissionId,
      admin: input.admin,
      reviewNote: note,
    });
  } catch (error) {
    if (error instanceof DeedModerationRpcError) {
      throw new DeedModerationError(error.code, error.message, error.status);
    }
    throw error;
  }
}

/**
 * Sign image evidence for a known submission only — never arbitrary paths.
 */
export async function signSubmissionEvidenceImage(
  submissionId: string,
): Promise<{ signedUrl: string; expiresIn: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deed_submissions")
    .select("id, evidence_image_path")
    .eq("id", submissionId)
    .maybeSingle();

  if (error) {
    throw new DeedModerationError("read_failed", "Failed to load submission", 500);
  }
  if (!data) {
    throw new DeedModerationError("not_found", "Submission not found", 404);
  }

  const path = data.evidence_image_path as string | null;
  if (!path) {
    throw new DeedModerationError("no_image", "No image evidence", 404);
  }

  try {
    return await createDeedEvidenceSignedUrl(path);
  } catch (error) {
    if (error instanceof DeedImageError) {
      throw new DeedModerationError(error.code, error.message, error.status);
    }
    throw error;
  }
}

function toQueueItem(
  row: DeedSubmissionRow,
  deed: SafeDeed,
  outlawNumber: number,
): ModerationQueueItem {
  return {
    submissionId: row.id,
    deedId: deed.id,
    deedTitle: deed.title,
    deedSlug: deed.slug,
    reward: deed.reward,
    rewardLabel: formatDeedReward(deed.reward),
    outlawNumber,
    outlawLabel: `OUTLAW ${formatOutlawNumber(outlawNumber)}`,
    submittedAt: row.submitted_at,
    evidenceText: row.evidence_text,
    evidenceUrl: row.evidence_url,
    evidenceOther: row.evidence_other,
    hasImageEvidence: Boolean(row.evidence_image_path),
    isRepeatable: deed.isRepeatable,
  };
}
