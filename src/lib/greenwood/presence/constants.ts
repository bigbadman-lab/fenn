/**
 * Living Greenwood 2 — Fire presence timing (centralised).
 * Timeout filtering is the authority for “present”; not beforeunload.
 */

/** Client heartbeat while The Fire is visible. */
export const GREENWOOD_FIRE_HEARTBEAT_MS = 22_000;

/**
 * Active window after last server-recorded heartbeat.
 * Members outside this window are absent, even if sitting=true.
 */
export const GREENWOOD_FIRE_ACTIVE_TIMEOUT_MS = 75_000;

/** Poll Fire presence list while visible. */
export const GREENWOOD_FIRE_PRESENCE_REFRESH_MS = 25_000;
