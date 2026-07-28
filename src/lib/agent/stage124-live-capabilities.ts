/**
 * Stage 12.4 trusted live-state allow-list.
 * Only these capabilities may execute trusted READ adapters.
 */

export const STAGE124_LIVE_CAPABILITIES = [
  "treasury",
  "commons",
  "wall",
  "deeds",
] as const;

export type Stage124LiveCapability =
  (typeof STAGE124_LIVE_CAPABILITIES)[number];

export const STAGE124_LIVE_CAPABILITY_MAX = 3;

export const STAGE124_WALL_MAX_ENTRIES = 3;
export const STAGE124_WALL_ENTRY_MAX_CHARS = 300;

export const STAGE124_DEEDS_MAX_ENTRIES = 3;
export const STAGE124_DEED_TEXT_MAX_CHARS = 300;

export const STAGE124_TREASURY_MAX_ASSETS = 5;

export const STAGE124_COMMONS_MAX_COMMITMENTS = 10;

