/**
 * Desk-safe DTOs for Clearing moderation (client-importable).
 * Never includes cookies, wallets, network hashes, or service secrets.
 */

export const CLEARING_SLOW_MODE_PRESETS = [0, 3, 5, 10, 30, 60] as const;
export type ClearingSlowModeSeconds = (typeof CLEARING_SLOW_MODE_PRESETS)[number];

export const CLEARING_MUTE_PRESETS_SECONDS = [
  10 * 60,
  60 * 60,
  24 * 60 * 60,
  7 * 24 * 60 * 60,
] as const;

export type ClearingDeskMessageFilter =
  | "all"
  | "visible"
  | "hidden"
  | "traveller"
  | "outlaw"
  | "voice_blocked";

export type ClearingDeskAuthorVoice = {
  muted: boolean;
  banned: boolean;
  mutedUntil: string | null;
  /** Published messages from this author (traveller) when cheaply available. */
  publishedCount?: number;
};

export type ClearingDeskMessage = {
  id: string;
  authorType: "traveller" | "outlaw" | "keeper";
  authorLabel: string;
  body: string;
  status: "published" | "hidden" | "rejected";
  createdAt: string;
  hiddenAt: string | null;
  moderationReason: string | null;
  /** Target for Traveller actions (Desk-only; not shown as a secret). */
  travellerId: string | null;
  /** Target for Outlaw/Keeper actions (Desk-only). */
  profileId: string | null;
  voice: ClearingDeskAuthorVoice | null;
};

export type ClearingDeskState = {
  readOnly: boolean;
  slowModeSeconds: number;
  updatedAt: string;
};

export type ClearingDeskSummary = {
  mode: "open" | "read_only";
  slowModeSeconds: number;
  publishedCount: number;
  hiddenCount: number;
  mutedTravellerCount: number;
  bannedTravellerCount: number;
  mutedOutlawCount: number;
  bannedOutlawCount: number;
  lastActionAt: string | null;
  lastActionLabel: string | null;
};

export type ClearingModerationLogItem = {
  id: string;
  action: string;
  targetLabel: string | null;
  reason: string | null;
  actorLabel: string;
  createdAt: string;
  messageId: string | null;
};

export type ClearingDeskSnapshot = {
  summary: ClearingDeskSummary;
  state: ClearingDeskState;
  messages: ClearingDeskMessage[];
  nextCursor: string | null;
  log: ClearingModerationLogItem[];
};

export function isAllowedSlowModeSeconds(
  value: unknown,
): value is ClearingSlowModeSeconds {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (CLEARING_SLOW_MODE_PRESETS as readonly number[]).includes(value)
  );
}

export function muteUntilFromPresetSeconds(seconds: number, nowMs = Date.now()): string {
  return new Date(nowMs + seconds * 1000).toISOString();
}
