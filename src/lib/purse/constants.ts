/**
 * Purse Stage P0 constants.
 * Manual operator transfer only — fixed 1 official FENN on Robinhood.
 */

/** Formatted human amount for the P0 operator CLI. Never free-form. */
export const P0_MANUAL_TRANSFER_AMOUNT_FORMATTED = "1" as const;

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

/** Default actor label for the P0 CLI. */
export const P0_MANUAL_ACTOR_ID = "ops:purse-transfer-one";
