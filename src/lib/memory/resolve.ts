import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MEMORY_REVIEW_ACTOR_ID,
  MEMORY_REVIEW_OPENAI_MODEL,
  MEMORY_REVIEW_PROMPT_VERSION,
} from "@/lib/memory/config";
import { MemoryReviewError } from "@/lib/memory/errors";
import type { MemoryReviewResult } from "@/lib/memory/review-schema";

export type ResolveMemoryResult = {
  finalized: boolean;
  candidateId: string;
  status: "approved" | "discarded";
  resultingMemoryId: string | null;
};

type RpcRow = {
  finalized: boolean;
  candidate_id: string;
  status: string;
  resulting_memory_id: string | null;
};

function mapRpcError(error: { message?: string; code?: string }): never {
  const message = error.message ?? "Memory resolve failed";
  if (message.includes("FENN_NOT_FOUND")) {
    throw new MemoryReviewError(
      "memory_candidate_not_found",
      "Memory candidate not found",
      404,
    );
  }
  if (message.includes("discarded candidate cannot approve")) {
    throw new MemoryReviewError(
      "memory_candidate_not_pending",
      "Discarded candidate cannot approve",
      409,
    );
  }
  if (message.includes("approved candidate cannot discard")) {
    throw new MemoryReviewError(
      "memory_candidate_not_pending",
      "Approved candidate cannot discard",
      409,
    );
  }
  if (message.includes("not pending")) {
    throw new MemoryReviewError(
      "memory_candidate_not_pending",
      "Memory candidate is not pending",
      409,
    );
  }
  throw new MemoryReviewError("memory_resolve_failed", message, 500);
}

function reviewMetadata(result: MemoryReviewResult): Record<string, unknown> {
  return {
    reviewer_version: MEMORY_REVIEW_PROMPT_VERSION,
    model: MEMORY_REVIEW_OPENAI_MODEL,
    reason_code: result.reasonCode,
    auto_reviewed: true,
  };
}

/**
 * Atomically approve a pending candidate into greenwood_memory + camp visibility.
 * Layer/visibility are DB-enforced — never taken from the model.
 */
export async function resolveMemoryCandidateApprove(input: {
  candidateId: string;
  title: string;
  content: string;
  reasonCode: string;
  review: MemoryReviewResult;
  admin: SupabaseClient;
  actorId?: string;
}): Promise<ResolveMemoryResult> {
  const actorId = input.actorId ?? MEMORY_REVIEW_ACTOR_ID;
  const { data, error } = await input.admin.rpc(
    "resolve_memory_candidate_approve",
    {
      p_candidate_id: input.candidateId,
      p_actor_id: actorId,
      p_title: input.title,
      p_content: input.content,
      p_reason_code: input.reasonCode,
      p_review_metadata: reviewMetadata(input.review),
    },
  );

  if (error) mapRpcError(error);
  const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null;
  if (!row) {
    throw new MemoryReviewError(
      "memory_resolve_failed",
      "Approve RPC returned no row",
      500,
    );
  }
  if (row.status !== "approved") {
    throw new MemoryReviewError(
      "memory_resolve_failed",
      "Approve RPC returned unexpected status",
      500,
    );
  }
  return {
    finalized: Boolean(row.finalized),
    candidateId: row.candidate_id,
    status: "approved",
    resultingMemoryId: row.resulting_memory_id,
  };
}

/**
 * Atomically discard a pending candidate. No memory row.
 */
export async function resolveMemoryCandidateDiscard(input: {
  candidateId: string;
  reasonCode: string;
  review: MemoryReviewResult;
  admin: SupabaseClient;
  actorId?: string;
}): Promise<ResolveMemoryResult> {
  const actorId = input.actorId ?? MEMORY_REVIEW_ACTOR_ID;
  const { data, error } = await input.admin.rpc(
    "resolve_memory_candidate_discard",
    {
      p_candidate_id: input.candidateId,
      p_actor_id: actorId,
      p_reason_code: input.reasonCode,
      p_review_metadata: reviewMetadata(input.review),
    },
  );

  if (error) mapRpcError(error);
  const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null;
  if (!row) {
    throw new MemoryReviewError(
      "memory_resolve_failed",
      "Discard RPC returned no row",
      500,
    );
  }
  if (row.status !== "discarded") {
    throw new MemoryReviewError(
      "memory_resolve_failed",
      "Discard RPC returned unexpected status",
      500,
    );
  }
  return {
    finalized: Boolean(row.finalized),
    candidateId: row.candidate_id,
    status: "discarded",
    resultingMemoryId: null,
  };
}
