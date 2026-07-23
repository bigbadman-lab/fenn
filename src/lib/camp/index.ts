export type {
  CampCharacterConfig,
  CampCharacterSlug,
  CampContributionEvaluation,
  CampConversationRole,
  CampHistoryMessage,
  CampStructuredAiResult,
  CampTurnInput,
  CampTurnResult,
} from "@/lib/camp/types";

export { CAMP_CHARACTER_SLUGS } from "@/lib/camp/types";

export {
  CAMP_DISPLAY_MESSAGE_LIMIT,
  CAMP_HISTORY_MESSAGE_LIMIT,
  CAMP_MAX_COMPLETION_TOKENS,
  CAMP_OPENAI_MODEL,
  CAMP_REPETITION_LOOKBACK,
  CAMP_REPETITION_SIMILARITY_THRESHOLD,
  CAMP_REWARD_RECOMMENDATION_MAX,
  CAMP_SCORE_MAX,
  CAMP_SCORE_MIN,
  CAMP_SPAM_FLOOR_ON_SIGNAL,
  CAMP_USER_MESSAGE_MAX_CHARS,
} from "@/lib/camp/config";

export {
  CampAiError,
  campErrorCopy,
  type CampAiErrorCode,
} from "@/lib/camp/errors";

export type {
  SafeCampCharacter,
  SafeCampConversation,
  SafeCampMessage,
  SafeCampReward,
} from "@/lib/camp/dto";

export {
  CAMP_REWARD_DEFAULTS,
  CAMP_REWARD_SETTING_KEYS,
  resolveCampRewardEligibility,
  campRewardUtcDate,
  isCampRewardCooldownActive,
  type CampRewardReason,
  type CampRewardPolicyResult,
} from "@/lib/camp/reward-policy";

export {
  campRequestHashes,
  isCampClientMessageId,
  isCampCharacterSlugParam,
} from "@/lib/camp/hash";

export { sendCampMessageBodySchema } from "@/lib/camp/request";

export {
  campContributionEvaluationSchema,
  campStructuredAiResultSchema,
  parseCampStructuredAiResult,
  safeParseCampStructuredAiResult,
} from "@/lib/camp/evaluation";

export {
  normalizeCampEvaluation,
  type CampEvaluationSignals,
  type NormalizedCampEvaluation,
} from "@/lib/camp/normalize-evaluation";

export {
  campTokenJaccardSimilarity,
  detectCampRepetition,
  detectCampRewardGaming,
  normalizeCampContentForComparison,
} from "@/lib/camp/signals";

export {
  boundCampConversationHistory,
  validateCampUserMessage,
} from "@/lib/camp/history";

// Server-only persistence / runtime / prompts: import modules directly from trusted server code.
