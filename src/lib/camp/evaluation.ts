import { z } from "zod";

import {
  CAMP_REWARD_RECOMMENDATION_MAX,
  CAMP_SCORE_MAX,
  CAMP_SCORE_MIN,
} from "@/lib/camp/config";
import type { CampStructuredAiResult } from "@/lib/camp/types";

/**
 * Structured Camp AI result — aligns with camp_messages evaluation columns.
 * rewardRecommendation is never accounting authority.
 */
export const campContributionEvaluationSchema = z.object({
  rewardRecommendation: z
    .number()
    .int()
    .min(0)
    .max(CAMP_REWARD_RECOMMENDATION_MAX),
  memoryCandidate: z.boolean(),
  quality: z.number().int().min(CAMP_SCORE_MIN).max(CAMP_SCORE_MAX),
  originality: z.number().int().min(CAMP_SCORE_MIN).max(CAMP_SCORE_MAX),
  relevance: z.number().int().min(CAMP_SCORE_MIN).max(CAMP_SCORE_MAX),
  spamProbability: z.number().min(0).max(1),
  reason: z.string().min(1).max(500),
});

export const campStructuredAiResultSchema = z.object({
  reply: z.string().min(1).max(4000),
  evaluation: campContributionEvaluationSchema,
});

export type ParsedCampStructuredAiResult = z.infer<
  typeof campStructuredAiResultSchema
>;

export function parseCampStructuredAiResult(
  value: unknown,
): CampStructuredAiResult {
  return campStructuredAiResultSchema.parse(value);
}

export function safeParseCampStructuredAiResult(value: unknown) {
  return campStructuredAiResultSchema.safeParse(value);
}
