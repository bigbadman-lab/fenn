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
  CAMP_REWARD_RECOMMENDATION_MAX,
  CAMP_SCORE_MAX,
  CAMP_SCORE_MIN,
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
} from "@/lib/camp/dto";

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
  boundCampConversationHistory,
  validateCampUserMessage,
} from "@/lib/camp/history";

// Server-only persistence / runtime: import modules directly from trusted server code.