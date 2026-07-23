import "server-only";

import type { FennAdminIdentity } from "@/lib/admin/auth";
import {
  DeedModerationRpcError,
  mapDeedModerationRpcError,
} from "@/lib/deeds/moderation-rpc-errors";
import { createAdminClient } from "@/lib/supabase/admin";

export type {
  DeedModerationRpcErrorCode,
} from "@/lib/deeds/moderation-rpc-errors";
export {
  DeedModerationRpcError,
  mapDeedModerationRpcError,
} from "@/lib/deeds/moderation-rpc-errors";

export type ApproveDeedSubmissionAtomicInput = {
  submissionId: string;
  admin: FennAdminIdentity;
  /** Required for range rewards; ignored/must match for fixed; null/0 for none. */
  leafAmount?: number | null;
  reviewNote?: string | null;
};

export type ApproveDeedSubmissionAtomicResult = {
  finalized: boolean;
  submissionId: string;
  deedId: string;
  profileId: string;
  status: "approved";
  leafAwarded: number;
  leafLedgerId: string | null;
  deedCompletionsCount: number;
  profileDeedsCompletedCount: number;
};

export type RejectDeedSubmissionAtomicInput = {
  submissionId: string;
  admin: FennAdminIdentity;
  reviewNote: string;
};

export type RejectDeedSubmissionAtomicResult = {
  finalized: boolean;
  submissionId: string;
  deedId: string;
  profileId: string;
  status: "rejected";
  reviewNote: string;
};

type ApproveRpcRow = {
  finalized: boolean;
  submission_id: string;
  deed_id: string;
  profile_id: string;
  status: string;
  leaf_awarded: number | null;
  leaf_ledger_id: string | null;
  deed_completions_count: number;
  profile_deeds_completed_count: number;
};

type RejectRpcRow = {
  finalized: boolean;
  submission_id: string;
  deed_id: string;
  profile_id: string;
  status: string;
  review_note: string | null;
};

/**
 * Thin wrapper around public.approve_deed_submission.
 * Caller must already have requireFennAdmin().
 */
export async function approveDeedSubmissionAtomic(
  input: ApproveDeedSubmissionAtomicInput,
): Promise<ApproveDeedSubmissionAtomicResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("approve_deed_submission", {
    p_submission_id: input.submissionId,
    p_actor_id: input.admin.actorId,
    p_leaf_amount: input.leafAmount ?? null,
    p_review_note: input.reviewNote ?? null,
  });

  if (error) {
    throw mapDeedModerationRpcError(error.message ?? "");
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | ApproveRpcRow
    | undefined;

  if (!row || row.status !== "approved") {
    throw new DeedModerationRpcError(
      "rpc_failed",
      "Approval RPC returned no approved row",
      500,
    );
  }

  return {
    finalized: Boolean(row.finalized),
    submissionId: row.submission_id,
    deedId: row.deed_id,
    profileId: row.profile_id,
    status: "approved",
    leafAwarded: row.leaf_awarded ?? 0,
    leafLedgerId: row.leaf_ledger_id,
    deedCompletionsCount: row.deed_completions_count,
    profileDeedsCompletedCount: row.profile_deeds_completed_count,
  };
}

/**
 * Thin wrapper around public.reject_deed_submission.
 * Caller must already have requireFennAdmin().
 */
export async function rejectDeedSubmissionAtomic(
  input: RejectDeedSubmissionAtomicInput,
): Promise<RejectDeedSubmissionAtomicResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reject_deed_submission", {
    p_submission_id: input.submissionId,
    p_actor_id: input.admin.actorId,
    p_review_note: input.reviewNote,
  });

  if (error) {
    throw mapDeedModerationRpcError(error.message ?? "");
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | RejectRpcRow
    | undefined;

  if (!row || row.status !== "rejected") {
    throw new DeedModerationRpcError(
      "rpc_failed",
      "Rejection RPC returned no rejected row",
      500,
    );
  }

  return {
    finalized: Boolean(row.finalized),
    submissionId: row.submission_id,
    deedId: row.deed_id,
    profileId: row.profile_id,
    status: "rejected",
    reviewNote: row.review_note ?? "",
  };
}
