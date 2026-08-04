/**
 * Pre-launch World Pulse intervals (client visibility refresh).
 * Not a runtime settings system — fixed MVP cadence.
 */
export const WORLD_PULSE_COMMONS_MS = 60_000;
export const WORLD_PULSE_WALL_MS = 25_000;
export const WORLD_PULSE_DEEDS_MS = 60_000;
export const WORLD_PULSE_LEDGER_MS = 25_000;

/**
 * Fire presence list refresh while The Fire is visible.
 * Heartbeat cadence lives in greenwood/presence/constants.
 */
export const WORLD_PULSE_GREENWOOD_FIRE_MS = 25_000;

/** Fire Gathering active/upcoming refresh while visible. */
export const WORLD_PULSE_GREENWOOD_GATHERING_MS = 25_000;

/** Hollow Fire indicator — restrained; not a reward-detail poller. */
export const WORLD_PULSE_GREENWOOD_HOLLOW_MS = 60_000;

/**
 * Homepage World Call map signal — isolated from full-page ISR.
 * Gentle so expiry is close without aggressive global polling.
 */
export const WORLD_PULSE_HOME_GATHERING_MS = 30_000;

/** Minimum gap between focus/visibility profile refreshes. */
export const WORLD_PULSE_PROFILE_FOCUS_MIN_MS = 15_000;
