import { z } from "zod";

import {
  MEMORY_APPROVE_REASON_CODES,
  MEMORY_DISCARD_REASON_CODES,
  type MemoryReviewReasonCode,
} from "@/lib/memory/config";

export const memoryReviewApproveSchema = z.object({
  decision: z.literal("approve"),
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(2000),
  reasonCode: z.enum(MEMORY_APPROVE_REASON_CODES),
});

export const memoryReviewDiscardSchema = z.object({
  decision: z.literal("discard"),
  reasonCode: z.enum(MEMORY_DISCARD_REASON_CODES),
});

export const memoryReviewResultSchema = z.discriminatedUnion("decision", [
  memoryReviewApproveSchema,
  memoryReviewDiscardSchema,
]);

export type MemoryReviewResult = z.infer<typeof memoryReviewResultSchema>;

export function parseMemoryReviewResult(value: unknown): MemoryReviewResult {
  return memoryReviewResultSchema.parse(value);
}

export function safeParseMemoryReviewResult(value: unknown) {
  return memoryReviewResultSchema.safeParse(value);
}

/** Strip and reject any attempt to smuggle application-controlled fields. */
export function assertReviewResultHasNoAuthorityFields(
  value: unknown,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const obj = value as Record<string, unknown>;
  const forbidden = [
    "visibility",
    "layer",
    "sourceProfileId",
    "source_profile_id",
    "sourceMessageId",
    "source_message_id",
    "sourceCandidateId",
    "source_candidate_id",
    "approvedByActorId",
    "approved_by_actor_id",
    "isActive",
    "is_active",
    "profileId",
    "actorId",
  ];
  for (const key of forbidden) {
    if (key in obj) {
      throw new Error(`Forbidden review field: ${key}`);
    }
  }
}

export type { MemoryReviewReasonCode };
