/** Outlaw Invite product constants (MVP). */

export const INVITE_REWARD_PER = 5 as const;
export const INVITE_REWARD_CAP = 10 as const;
export const INVITE_MAX_LEAF = INVITE_REWARD_PER * INVITE_REWARD_CAP;

/** Cookie holding only the invite code (revalidated server-side). */
export const INVITE_COOKIE_NAME = "fenn_invite";

/** Attribution cookie lifetime: 14 days. */
export const INVITE_COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

/** Invite code format: URL-safe alphanumeric, 8–32 chars. */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{8,32}$/;

export const INVITE_CODE_MIN_LENGTH = 8;
export const INVITE_CODE_MAX_LENGTH = 32;
