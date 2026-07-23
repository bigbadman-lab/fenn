import type { CampContributionEvaluation } from "@/lib/camp/types";
import { spamFloorForSignals } from "@/lib/camp/signals";

export type CampEvaluationSignals = {
  repeatedContent: boolean;
  repetitionSimilarity: number | null;
  rewardGaming: boolean;
};

export type NormalizedCampEvaluation = {
  evaluation: CampContributionEvaluation;
  originalRecommendation: number;
  finalRecommendation: number;
  originalMemoryCandidate: boolean;
  finalMemoryCandidate: boolean;
  normalizedByServer: true;
  signals: CampEvaluationSignals;
};

/**
 * Server sanity filter for model evaluation.
 * May reduce recommendation / memoryCandidate; never increases recommendation.
 *
 * Rules (documented):
 * - spamProbability >= 0.8 → recommendation 0
 * - quality <= 1 → 0
 * - relevance <= 1 → 0
 * - originality == 0 → 0
 * - recommendation > 0 requires quality >= 2 and relevance >= 2
 * - recommendation 2 requires quality >= 2, relevance >= 2, originality >= 1
 * - recommendation 3 requires quality 3, relevance 3, originality >= 2, spam < 0.3
 * - repetition / reward-gaming signals force recommendation 0 and memoryCandidate false
 * - memoryCandidate also requires quality >= 2, relevance >= 2, originality >= 1, spam < 0.8
 */
export function normalizeCampEvaluation(input: {
  raw: CampContributionEvaluation;
  signals: CampEvaluationSignals;
}): NormalizedCampEvaluation {
  const originalRecommendation = clampRecommendation(
    input.raw.rewardRecommendation,
  );
  const originalMemoryCandidate = Boolean(input.raw.memoryCandidate);

  const quality = clampScore(input.raw.quality);
  const originality = clampScore(input.raw.originality);
  const relevance = clampScore(input.raw.relevance);
  const spamProbability = clampUnit(
    spamFloorForSignals({
      repeatedContent: input.signals.repeatedContent,
      rewardGaming: input.signals.rewardGaming,
      currentSpam: input.raw.spamProbability,
    }),
  );

  let rewardRecommendation = originalRecommendation;

  if (input.signals.repeatedContent || input.signals.rewardGaming) {
    rewardRecommendation = 0;
  }

  if (spamProbability >= 0.8) rewardRecommendation = 0;
  if (quality <= 1) rewardRecommendation = 0;
  if (relevance <= 1) rewardRecommendation = 0;
  if (originality === 0) rewardRecommendation = 0;

  if (rewardRecommendation > 0 && (quality < 2 || relevance < 2)) {
    rewardRecommendation = 0;
  }

  if (rewardRecommendation === 2) {
    if (!(quality >= 2 && relevance >= 2 && originality >= 1)) {
      rewardRecommendation = 0;
    }
  }

  if (rewardRecommendation === 3) {
    const exceptional =
      quality === 3 &&
      relevance === 3 &&
      originality >= 2 &&
      spamProbability < 0.3;
    if (!exceptional) {
      // Reduce: try 2 if eligible, else 0.
      rewardRecommendation =
        quality >= 2 && relevance >= 2 && originality >= 1 ? 2 : 0;
      if (rewardRecommendation === 2) {
        if (!(quality >= 2 && relevance >= 2 && originality >= 1)) {
          rewardRecommendation = 0;
        }
      }
      if (spamProbability >= 0.8 || quality <= 1 || relevance <= 1 || originality === 0) {
        rewardRecommendation = 0;
      }
    }
  }

  // Absolute ceiling: never exceed model recommendation.
  if (rewardRecommendation > originalRecommendation) {
    rewardRecommendation = originalRecommendation;
  }

  let memoryCandidate = originalMemoryCandidate;
  if (
    input.signals.repeatedContent ||
    input.signals.rewardGaming ||
    spamProbability >= 0.8 ||
    quality < 2 ||
    relevance < 2 ||
    originality < 1
  ) {
    memoryCandidate = false;
  }

  return {
    evaluation: {
      rewardRecommendation,
      memoryCandidate,
      quality,
      originality,
      relevance,
      spamProbability,
      reason: input.raw.reason,
    },
    originalRecommendation,
    finalRecommendation: rewardRecommendation,
    originalMemoryCandidate,
    finalMemoryCandidate: memoryCandidate,
    normalizedByServer: true,
    signals: input.signals,
  };
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(3, Math.max(0, Math.trunc(value)));
}

function clampRecommendation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(3, Math.max(0, Math.trunc(value)));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
