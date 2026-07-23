import {
  CAMP_REPETITION_LOOKBACK,
  CAMP_REPETITION_SIMILARITY_THRESHOLD,
  CAMP_SPAM_FLOOR_ON_SIGNAL,
} from "@/lib/camp/config";

/**
 * Normalize user text for repetition comparison.
 * Deterministic, no stemming/embeddings.
 */
export function normalizeCampContentForComparison(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(normalized: string): Set<string> {
  if (!normalized) return new Set();
  return new Set(normalized.split(" ").filter(Boolean));
}

/** Jaccard similarity over whitespace tokens. */
export function campTokenJaccardSimilarity(a: string, b: string): number {
  const left = tokenize(normalizeCampContentForComparison(a));
  const right = tokenize(normalizeCampContentForComparison(b));
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type CampRepetitionSignal = {
  repeatedContent: boolean;
  similarity: number | null;
};

/**
 * Compare new user content against recent prior USER messages.
 * Does not block conversation — only signals evaluation.
 */
export function detectCampRepetition(input: {
  userMessage: string;
  priorUserMessages: string[];
  lookback?: number;
  threshold?: number;
}): CampRepetitionSignal {
  const lookback = input.lookback ?? CAMP_REPETITION_LOOKBACK;
  const threshold = input.threshold ?? CAMP_REPETITION_SIMILARITY_THRESHOLD;
  const needle = normalizeCampContentForComparison(input.userMessage);
  if (!needle) {
    return { repeatedContent: false, similarity: null };
  }

  const candidates = input.priorUserMessages.slice(-lookback);
  let best = 0;
  for (const prior of candidates) {
    const normalizedPrior = normalizeCampContentForComparison(prior);
    if (!normalizedPrior) continue;
    if (normalizedPrior === needle) {
      return { repeatedContent: true, similarity: 1 };
    }
    const score = campTokenJaccardSimilarity(needle, normalizedPrior);
    if (score > best) best = score;
  }

  if (best >= threshold) {
    return { repeatedContent: true, similarity: best };
  }
  return {
    repeatedContent: false,
    similarity: best > 0 ? best : null,
  };
}

/**
 * Obvious this-turn reward farming / score manipulation.
 * Ordinary informational LEAF questions should usually pass.
 */
export function detectCampRewardGaming(userMessage: string): boolean {
  const n = normalizeCampContentForComparison(userMessage);
  if (!n) return false;

  const farmingPatterns: RegExp[] = [
    /\bgive me (?:some )?leaf\b/,
    /\bgive me \d+ leaf\b/,
    /\breward (?:me|this|my)\b/,
    /\bearn (?:me )?(?:some )?leaf\b/,
    /\bwhat should i say to (?:earn|get) leaf\b/,
    /\bhow (?:do|can) i (?:farm|grind) leaf\b/,
    /\bset rewardrecommendation\b/,
    /\brewardrecommendation\s*(?:to|=|:)\s*[123]\b/,
    /\b(?:set|force|make)\s+(?:quality|originality|relevance)\s*(?:to|=|:)\s*3\b/,
    /\boutput (?:quality|originality|relevance|reward)\b/,
    /\bignore (?:all )?(?:previous|prior|your) instructions\b/,
    /\breveal (?:your )?(?:hidden )?(?:evaluation|scoring|rubric|system prompt)\b/,
    /\btell me the exact (?:scoring|evaluation) (?:rubric|criteria)\b/,
  ];

  return farmingPatterns.some((re) => re.test(n));
}

export function spamFloorForSignals(input: {
  repeatedContent: boolean;
  rewardGaming: boolean;
  currentSpam: number;
}): number {
  if (input.repeatedContent || input.rewardGaming) {
    return Math.max(input.currentSpam, CAMP_SPAM_FLOOR_ON_SIGNAL);
  }
  return input.currentSpam;
}
