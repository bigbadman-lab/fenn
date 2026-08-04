export {
  announcementStyleFromMetadata,
  DEFAULT_GATHERING_ANNOUNCEMENT_STYLE,
  gatheringAnnouncementStyleLabel,
  GATHERING_ANNOUNCEMENT_STYLES,
  metadataWithAnnouncementStyle,
  parseGatheringAnnouncementStyle,
} from "@/lib/greenwood/gatherings/announcement-style";
export type { GatheringAnnouncementStyle } from "@/lib/greenwood/gatherings/announcement-style";

export {
  formatGatheringCountdown,
} from "@/lib/greenwood/gatherings/countdown";

export {
  durationMinutesBetween,
  formatBeginsInLabel,
  formatDurationMinutesLabel,
  formatRemainingDurationLabel,
  GATHERING_DURATION_MAX_MINUTES,
  GATHERING_DURATION_MIN_MINUTES,
  GATHERING_DURATION_PRESETS,
  isValidGatheringDurationMinutes,
} from "@/lib/greenwood/gatherings/duration";

export {
  gatheringWindowsOverlap,
  isMemberVisibleState,
  resolveGatheringState,
  resolveGatheringStateFromRow,
} from "@/lib/greenwood/gatherings/state";

export type {
  AdminGatheringDetail,
  AdminGatheringHandRow,
  AdminGatheringListItem,
  FireGatheringsSnapshot,
  GatheringAdminStatus,
  GatheringInteractionType,
  GatheringResolvedState,
  SafeGathering,
} from "@/lib/greenwood/gatherings/types";

/** World Pulse cadence for Fire Gathering refresh. */
export const GREENWOOD_FIRE_GATHERING_REFRESH_MS = 25_000;

// Server-only member/admin ops: import from member-ops.ts / admin-ops.ts.
