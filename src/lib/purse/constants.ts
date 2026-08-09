/**
 * Purse Stage P0 constants.
 * Manual operator transfer only — fixed 1 official FENN on Robinhood.
 */

/** Formatted human amount for the P0 operator CLI. Never free-form. */
export const P0_MANUAL_TRANSFER_AMOUNT_FORMATTED = "1" as const;

/**
 * Canonical dead-address burn destination (ERC-20 transfer, not native burn()).
 * Normalized lowercase form used internally — never env-overridable.
 */
export const FENN_DEAD_ADDRESS =
  "0x000000000000000000000000000000000000dead" as const;

export const PURSE_ACTION_TYPES = ["transfer", "burn"] as const;
export type PurseActionType = (typeof PURSE_ACTION_TYPES)[number];

export const PURSE_TRANSFER_STATUSES = [
  "pending",
  "submitted",
  "confirmed",
  "failed",
  "ambiguous",
] as const;

export type PurseTransferStatus = (typeof PURSE_TRANSFER_STATUSES)[number];

export const PURSE_FAILURE_CLASSES = [
  "pre_broadcast",
  "terminal",
  "ambiguous",
] as const;

export type PurseFailureClass = (typeof PURSE_FAILURE_CLASSES)[number];

/** Public Commons history cap. */
export const PUBLIC_PURSE_TRANSFER_HISTORY_LIMIT = 25;

/** Env var holding the server-only private key (never logged, never DB). */
export const FENN_PURSE_PRIVATE_KEY_ENV = "FENN_PURSE_PRIVATE_KEY";

/** Strict enable string for pre-launch disposable-token test rail. */
export const FENN_PURSE_TEST_MODE_ENV = "FENN_PURSE_TEST_MODE";
export const FENN_PURSE_TEST_MODE_ALLOW = "explicit_allow" as const;
export const FENN_PURSE_TEST_TOKEN_ADDRESS_ENV = "FENN_PURSE_TEST_TOKEN_ADDRESS";
export const FENN_PURSE_TEST_TOKEN_DECIMALS_ENV =
  "FENN_PURSE_TEST_TOKEN_DECIMALS";

/** Default actor label for the P0 official-FENN CLI. */
export const P0_MANUAL_ACTOR_ID = "ops:purse-transfer-one";

/** Default actor label for the P0 disposable-token test CLI. */
export const P0_MANUAL_TEST_ACTOR_ID = "ops:purse-transfer-one-test-cli";
