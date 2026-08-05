/**
 * Clearing config — server constants. No LEAF.
 */

/** Max plain-text body characters (matches DB constraint). */
export const CLEARING_MESSAGE_MAX_CHARS = 1000;

/** Accepted Traveller posts before registration is required. */
export const CLEARING_TRAVELLER_MESSAGE_LIMIT = 3;

/** Default cooldown when slow_mode_seconds is 0 (seconds between posts per author). */
export const CLEARING_DEFAULT_COOLDOWN_SECONDS = 3;

/** Traveller-specific cooldown floor (more restricted). */
export const CLEARING_TRAVELLER_COOLDOWN_SECONDS = 5;

/** HttpOnly cookie name for signed Traveller id. */
export const CLEARING_TRAVELLER_COOKIE_NAME = "fenn_clearing_traveller";

/** Cookie max age (30 days). */
export const CLEARING_TRAVELLER_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Feed default / max page sizes. */
export const CLEARING_FEED_DEFAULT_LIMIT = 50;
export const CLEARING_FEED_MAX_LIMIT = 100;

/** Rate windows (configurable knobs for operators / tests). */
export const CLEARING_RATE_LIMITS = {
  travellerPostsPerWindow: 10,
  travellerWindowSeconds: 600,
  outlawPostsPerWindow: 30,
  outlawWindowSeconds: 600,
  networkPostsPerWindow: 40,
  networkWindowSeconds: 600,
  networkMintPerWindow: 20,
  networkMintWindowSeconds: 3600,
} as const;
