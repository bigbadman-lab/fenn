/**
 * Deterministic First Thirty CAMP eligibility (server-only decision).
 * Separate from long-term rewardRecommendation (0–3 LEAF policy).
 *
 * Never trust a browser-supplied flag. Persist the result on the assistant
 * message; the First Thirty RPC reads the column only.
 */

import type { CampEvaluationSignals } from "@/lib/camp/normalize-evaluation";
import { normalizeCampContentForComparison } from "@/lib/camp/signals";
import type { CampContributionEvaluation } from "@/lib/camp/types";

/** Existing hard spam floor used by ordinary CAMP normalization. */
export const FIRST_THIRTY_SPAM_HARD_THRESHOLD = 0.8;

/**
 * Internal, fixed reason codes — for logs / Desk aggregation only.
 * Never returned to members.
 */
export const FIRST_THIRTY_ELIGIBILITY_REASONS = [
  "eligible",
  "empty",
  "substance",
  "repeated",
  "reward_gaming",
  "spam",
  "quality",
  "relevance",
] as const;

export type FirstThirtyEligibilityReason =
  (typeof FIRST_THIRTY_ELIGIBILITY_REASONS)[number];

export type FirstThirtyCampEligibility = {
  eligible: boolean;
  reason: FirstThirtyEligibilityReason;
};

/** Single-token / two-token greetings and acknowledgements alone do not count. */
const LOW_SUBSTANCE_PHRASES = new Set([
  "hi",
  "hello",
  "hey",
  "hiya",
  "yo",
  "sup",
  "ok",
  "okay",
  "k",
  "kk",
  "yes",
  "no",
  "yep",
  "yeah",
  "yea",
  "nah",
  "sure",
  "cool",
  "nice",
  "good",
  "thanks",
  "thank you",
  "thx",
  "lol",
  "lmao",
  "haha",
  "hmm",
  "hm",
  "mhm",
  "hello there",
  "hi there",
  "hey there",
  "good morning",
  "good evening",
  "good night",
  "how are you",
  "whats up",
  "what s up",
]);

/**
 * Restraint: enough lexical content to form an answerable thought.
 * Not a crude min-length gate — short meaningful questions may pass.
 */
export function assessCampOnboardingSubstance(userMessage: string): boolean {
  const raw = userMessage.trim();
  if (!raw) return false;

  const normalized = normalizeCampContentForComparison(raw);
  if (!normalized) return false;
  if (LOW_SUBSTANCE_PHRASES.has(normalized)) return false;

  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0) return false;

  const hasQuestion = /\?/.test(raw);
  const charCount = normalized.length;

  // "why greenwood?", "what is fenn?", "is leaf earned?"
  if (hasQuestion && words.length >= 2 && charCount >= 8) return true;

  // Four+ content words: casual but real thought
  if (words.length >= 4) return true;

  // Three words with a little bulk
  if (words.length >= 3 && charCount >= 12) return true;

  // Two denser words ("describe greenwood", "explain leaf")
  if (words.length >= 2 && charCount >= 16) return true;

  return false;
}

/**
 * First Thirty participation eligibility from trusted scores + signals + substance.
 * Does **not** require originality or rewardRecommendation >= 1.
 */
export function deriveFirstThirtyCampEligibility(input: {
  userMessage: string;
  evaluation: Pick<
    CampContributionEvaluation,
    "quality" | "relevance" | "spamProbability"
  >;
  signals: Pick<CampEvaluationSignals, "repeatedContent" | "rewardGaming">;
}): FirstThirtyCampEligibility {
  if (input.signals.repeatedContent) {
    return { eligible: false, reason: "repeated" };
  }
  if (input.signals.rewardGaming) {
    return { eligible: false, reason: "reward_gaming" };
  }

  const spam = clampUnit(input.evaluation.spamProbability);
  if (spam >= FIRST_THIRTY_SPAM_HARD_THRESHOLD) {
    return { eligible: false, reason: "spam" };
  }

  if (!input.userMessage.trim()) {
    return { eligible: false, reason: "empty" };
  }

  if (!assessCampOnboardingSubstance(input.userMessage)) {
    return { eligible: false, reason: "substance" };
  }

  const quality = clampScore(input.evaluation.quality);
  const relevance = clampScore(input.evaluation.relevance);

  // quality 0 = noise; 1 = ordinary coherent (sufficient for arrival)
  if (quality < 1) {
    return { eligible: false, reason: "quality" };
  }
  // relevance 0 = off-role noise; 1 = loose-but-answerable (sufficient for arrival)
  if (relevance < 1) {
    return { eligible: false, reason: "relevance" };
  }

  return { eligible: true, reason: "eligible" };
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(3, Math.max(0, Math.trunc(value)));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
