/**
 * Camp domain types.
 * Private evaluation fields stay off public/client DTOs — use CampTurnResult
 * only on the server until a SafeCampReply DTO is defined in a later phase.
 */

export const CAMP_CHARACTER_SLUGS = ["fenn", "wren", "rook"] as const;

export type CampCharacterSlug = (typeof CAMP_CHARACTER_SLUGS)[number];

export type CampConversationRole = "user" | "assistant";

export type CampHistoryMessage = {
  role: CampConversationRole;
  content: string;
};

/**
 * Server-only contribution evaluation (maps to camp_messages columns).
 * Never serialize wholesale to the browser.
 */
export type CampContributionEvaluation = {
  rewardRecommendation: number;
  memoryCandidate: boolean;
  quality: number;
  originality: number;
  relevance: number;
  spamProbability: number;
  reason: string;
};

export type CampStructuredAiResult = {
  reply: string;
  evaluation: CampContributionEvaluation;
};

export type CampCharacterConfig = {
  slug: CampCharacterSlug;
  promptKey: string;
  version: string;
  displayName: string;
  purpose: string;
  evaluationFocus: string;
  systemInstructions: string;
};

export type CampTurnInput = {
  /** DB prompt_key or slug — resolved via server character config. */
  promptKey: string;
  outlawNumber?: number | null;
  conversationHistory: CampHistoryMessage[];
  userMessage: string;
};

export type CampTurnResult = {
  character: CampCharacterConfig;
  reply: string;
  /** Private — server only. */
  evaluation: CampContributionEvaluation;
  model: string;
  promptVersion: string;
};
