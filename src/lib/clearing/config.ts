/**
 * Clearing config — server constants. No LEAF.
 * Operational knobs; env may override selected values where documented.
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

/** Min dedicated cookie secret length in production. */
export const CLEARING_COOKIE_SECRET_MIN_PROD = 32;

/** Min dedicated cookie secret length in development. */
export const CLEARING_COOKIE_SECRET_MIN_DEV = 16;

/** Feed default / max page sizes. */
export const CLEARING_FEED_DEFAULT_LIMIT = 50;
export const CLEARING_FEED_MAX_LIMIT = 100;

/** Desk message page size. */
export const CLEARING_DESK_MESSAGE_LIMIT = 40;

/**
 * Public feed polling interval (ms). Launch recommendation: 5s.
 * Hidden tabs should pause; overlaps cancelled client-side.
 */
export const CLEARING_PUBLIC_POLL_MS = 5_000;

/** Desk snapshot poll interval (ms). */
export const CLEARING_DESK_POLL_MS = 15_000;

/** Absolute max JSON body for Clearing write APIs (bytes). */
export const CLEARING_MAX_REQUEST_BODY_BYTES = 8_192;

/** Max cursor string length (base64url). */
export const CLEARING_MAX_CURSOR_CHARS = 200;

/** Rate windows — multi-instance safe via Postgres RPC. */
export const CLEARING_RATE_LIMITS = {
  /** Soft rolling cap; hard cap remains three accepted messages. */
  travellerPostsPerWindow: 6,
  travellerWindowSeconds: 600,
  outlawPostsPerWindow: 24,
  outlawWindowSeconds: 600,
  networkPostsPerWindow: 36,
  networkWindowSeconds: 600,
  networkMintPerWindow: 12,
  networkMintWindowSeconds: 3600,
} as const;
