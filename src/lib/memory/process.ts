import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MEMORY_REVIEW_PENDING_BATCH_DEFAULT,
  MEMORY_REVIEW_PENDING_BATCH_MAX,
} from "@/lib/memory/config";
import { MemoryReviewError } from "@/lib/memory/errors";
import {
  deterministicMemoryDiscard,
  normalizeMemoryContentForDedup,
} from "@/lib/memory/guards";
import type { MemoryReviewModelCaller } from "@/lib/memory/reviewer";
import { reviewMemoryCandidateContent } from "@/lib/memory/reviewer";
import type { MemoryReviewResult } from "@/lib/memory/review-schema";
import {
  resolveMemoryCandidateApprove,
  resolveMemoryCandidateDiscard,
  type ResolveMemoryResult,
} from "@/lib/memory/resolve";

export type PendingMemoryCandidate = {
  id: string;
  profile_id: string;
  character_id: string | null;
  camp_message_id: string | null;
  content: string;
  status: string;
  resulting_memory_id: string | null;
};

export type ReviewAndResolveResult =
  | {
      outcome: "approved" | "discarded" | "already_resolved";
      resolve: ResolveMemoryResult;
    }
  | {
      outcome: "left_pending";
      reason: string;
    };

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

async function loadCandidate(
  admin: SupabaseClient,
  candidateId: string,
): Promise<PendingMemoryCandidate | null> {
  const { data, error } = await admin
    .from("memory_candidates")
    .select(
      "id, profile_id, character_id, camp_message_id, content, status, resulting_memory_id",
    )
    .eq("id", candidateId)
    .maybeSingle();

  if (error) {
    throw new MemoryReviewError(
      "memory_review_failed",
      "Failed to load memory candidate",
      500,
    );
  }
  return (data as PendingMemoryCandidate | null) ?? null;
}

async function findActiveDuplicateMemory(
  admin: SupabaseClient,
  curatedContent: string,
): Promise<boolean> {
  const normalized = normalizeMemoryContentForDedup(curatedContent);
  if (!normalized) return false;

  const { data, error } = await admin
    .from("fenn_memories")
    .select("id, content")
    .eq("layer", "greenwood_memory")
    .eq("is_active", true)
    .limit(100);

  if (error) return false;
  for (const row of data ?? []) {
    const content = (row as { content?: string }).content ?? "";
    if (normalizeMemoryContentForDedup(content) === normalized) {
      return true;
    }
  }
  return false;
}

async function applyReviewDecision(input: {
  candidateId: string;
  review: MemoryReviewResult;
  admin: SupabaseClient;
}): Promise<ResolveMemoryResult> {
  if (input.review.decision === "approve") {
    const duplicate = await findActiveDuplicateMemory(
      input.admin,
      input.review.content,
    );
    if (duplicate) {
      return resolveMemoryCandidateDiscard({
        candidateId: input.candidateId,
        reasonCode: "duplicate",
        review: { decision: "discard", reasonCode: "duplicate" },
        admin: input.admin,
      });
    }
    return resolveMemoryCandidateApprove({
      candidateId: input.candidateId,
      title: input.review.title,
      content: input.review.content,
      reasonCode: input.review.reasonCode,
      review: input.review,
      admin: input.admin,
    });
  }

  return resolveMemoryCandidateDiscard({
    candidateId: input.candidateId,
    reasonCode: input.review.reasonCode,
    review: input.review,
    admin: input.admin,
  });
}

/**
 * Review one candidate and resolve approve/discard.
 * Leaves pending on model/DB failure (caller may catch).
 */
export async function reviewAndResolveMemoryCandidate(input: {
  candidateId: string;
  admin?: SupabaseClient;
  callModel?: MemoryReviewModelCaller;
}): Promise<ReviewAndResolveResult> {
  const admin = input.admin ?? (await defaultAdmin());
  const candidate = await loadCandidate(admin, input.candidateId);
  if (!candidate) {
    throw new MemoryReviewError(
      "memory_candidate_not_found",
      "Memory candidate not found",
      404,
    );
  }

  if (candidate.status === "approved" || candidate.status === "discarded") {
    return {
      outcome: "already_resolved",
      resolve: {
        finalized: false,
        candidateId: candidate.id,
        status: candidate.status,
        resultingMemoryId: candidate.resulting_memory_id,
      },
    };
  }

  if (candidate.status !== "pending") {
    throw new MemoryReviewError(
      "memory_candidate_not_pending",
      "Memory candidate is not pending",
      409,
    );
  }

  const forced = deterministicMemoryDiscard(candidate.content);
  const review =
    forced ??
    (await reviewMemoryCandidateContent({
      candidateId: candidate.id,
      content: candidate.content,
      characterId: candidate.character_id,
      callModel: input.callModel,
    }));

  const resolve = await applyReviewDecision({
    candidateId: candidate.id,
    review,
    admin,
  });

  if (resolve.status === "approved" && resolve.resultingMemoryId) {
    const { bestEffortIndexFennMemory } = await import(
      "@/lib/memory/index-memory"
    );
    await bestEffortIndexFennMemory(resolve.resultingMemoryId, admin);
  }

  return {
    outcome: resolve.status === "approved" ? "approved" : "discarded",
    resolve,
  };
}

export type ProcessPendingMemoryResult = {
  scanned: number;
  approved: number;
  discarded: number;
  leftPending: number;
  alreadyResolved: number;
  errors: number;
};

/**
 * Bounded backlog processor for pending candidates.
 * Individual failures leave that candidate pending and continue.
 */
export async function processPendingMemoryCandidates(input?: {
  limit?: number;
  admin?: SupabaseClient;
  callModel?: MemoryReviewModelCaller;
}): Promise<ProcessPendingMemoryResult> {
  const admin = input?.admin ?? (await defaultAdmin());
  const requested = input?.limit ?? MEMORY_REVIEW_PENDING_BATCH_DEFAULT;
  const limit = Math.min(
    Math.max(1, Math.floor(requested)),
    MEMORY_REVIEW_PENDING_BATCH_MAX,
  );

  const { data, error } = await admin
    .from("memory_candidates")
    .select(
      "id, profile_id, character_id, camp_message_id, content, status, resulting_memory_id",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new MemoryReviewError(
      "memory_review_failed",
      "Failed to list pending memory candidates",
      500,
    );
  }

  const rows = (data ?? []) as PendingMemoryCandidate[];
  const summary: ProcessPendingMemoryResult = {
    scanned: rows.length,
    approved: 0,
    discarded: 0,
    leftPending: 0,
    alreadyResolved: 0,
    errors: 0,
  };

  for (const row of rows) {
    try {
      const result = await reviewAndResolveMemoryCandidate({
        candidateId: row.id,
        admin,
        callModel: input?.callModel,
      });
      if (result.outcome === "approved") summary.approved += 1;
      else if (result.outcome === "discarded") summary.discarded += 1;
      else if (result.outcome === "already_resolved") {
        summary.alreadyResolved += 1;
      } else summary.leftPending += 1;
    } catch {
      summary.errors += 1;
      summary.leftPending += 1;
    }
  }

  return summary;
}

/**
 * Best-effort: create candidate (Stage 7.5) then autonomously review.
 * Review failures leave pending and never throw to Camp.
 */
export async function createAndReviewMemoryCandidateFromCampMessage(input: {
  messageId: string;
  admin?: SupabaseClient;
  callModel?: MemoryReviewModelCaller;
}): Promise<{
  candidateCreated: boolean;
  reviewOutcome: ReviewAndResolveResult["outcome"] | "skipped" | "error";
}> {
  const admin = input.admin ?? (await defaultAdmin());
  const { createMemoryCandidateFromCampMessage } = await import(
    "@/lib/camp/memory-candidate"
  );

  const created = await createMemoryCandidateFromCampMessage({
    messageId: input.messageId,
    admin,
  });

  if (!created.candidate || created.candidate.status !== "pending") {
    return {
      candidateCreated: created.created,
      reviewOutcome: "skipped",
    };
  }

  try {
    const reviewed = await reviewAndResolveMemoryCandidate({
      candidateId: created.candidate.id,
      admin,
      callModel: input.callModel,
    });
    return {
      candidateCreated: created.created,
      reviewOutcome: reviewed.outcome,
    };
  } catch {
    return {
      candidateCreated: created.created,
      reviewOutcome: "error",
    };
  }
}
