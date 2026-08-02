export {
  GREENWOOD_FIRE_ACTIVE_TIMEOUT_MS,
  GREENWOOD_FIRE_HEARTBEAT_MS,
  GREENWOOD_FIRE_PRESENCE_REFRESH_MS,
} from "@/lib/greenwood/presence/constants";

export {
  compareFirePresenceMembers,
  isFirePresenceActive,
} from "@/lib/greenwood/presence/filter";

export type {
  FirePresenceMember,
  FirePresenceSelfState,
  FirePresenceSnapshot,
  FireSelfStatus,
} from "@/lib/greenwood/presence/types";

// Server-only ops / self-status: import from ops.ts / self-status.ts in trusted server code.
