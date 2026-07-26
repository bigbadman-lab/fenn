/**
 * X transport / external platform ear.
 * Not FENN judgement, memory, Wall, or speech.
 */

export { X_WRITE_AUTH_CONTRACT } from "@/lib/x/write-auth-contract";
export {
  FENN_X_USERNAME_DEFAULT,
  X_API_BASE_URL,
  X_HTTP_TIMEOUT_MS,
  X_POLL_STATE_KEY,
  getXReadConfig,
  type XReadConfig,
} from "@/lib/x/config";
export { XError, type XErrorCode } from "@/lib/x/errors";
export {
  assertSnowflakeId,
  compareSnowflake,
  maxSnowflake,
} from "@/lib/x/snowflake";
export {
  lookupUserByUsername,
  fetchUserMentions,
  type FetchMentionsResult,
  type LookupUserByUsernameResult,
  type XHttpFetch,
} from "@/lib/x/client";
export {
  derivePerceptionType,
  normalizeMention,
  validateMentionsResponse,
  validateUserLookupResponse,
  type NormalizedXPerception,
  type PerceptionType,
} from "@/lib/x/validate";
export {
  computeContiguousSinceId,
  ingestXPerception,
  readMentionsSinceId,
  writeMentionsSinceId,
  type IngestResult,
} from "@/lib/x/persist";
export {
  pollXMentions,
  formatXPollReport,
  type XPollAggregate,
} from "@/lib/x/poll";
export {
  verifyFennXAccount,
  formatAccountVerification,
  type XAccountVerification,
} from "@/lib/x/account";
