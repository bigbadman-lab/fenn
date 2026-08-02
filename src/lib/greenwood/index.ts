export type {
  GreenwoodAdmissionAlreadyMember,
  GreenwoodAdmissionAdmitted,
  GreenwoodAdmissionNotEligible,
  GreenwoodAdmissionResult,
  GreenwoodEligibleStatus,
  GreenwoodIneligibleStatus,
  GreenwoodMemberStatus,
  GreenwoodStatus,
} from "@/lib/greenwood/types";

export {
  GreenwoodError,
  type GreenwoodErrorCode,
} from "@/lib/greenwood/errors";

export type {
  GreenwoodGateView,
  GreenwoodMemberSnapshotView,
  GreenwoodStandingView,
} from "@/lib/greenwood/gate-view";

export {
  canSubmitGreenwoodEnter,
  resolveAuthGateBranch,
  viewFromAdmissionResult,
  viewFromGreenwoodStatus,
} from "@/lib/greenwood/gate-view";

export {
  GREENWOOD_FIRE_DORMANT_PATHS,
  GREENWOOD_MEMBER_PATHS,
  memberInteriorCopy,
} from "@/lib/greenwood/member-paths";

export {
  GREENWOOD_FIRE_ASCII,
  GREENWOOD_FIRE_MESSAGE,
  GREENWOOD_FIRE_MESSAGE_FALLBACK,
  GREENWOOD_FIRE_MESSAGE_MAX_CHARS,
  fireMessageBodyToParagraphs,
  paragraphsToFireMessageBody,
  validateFireMessageBodyInput,
} from "@/lib/greenwood/fire-message";

export type { SafeGreenwoodSigil } from "@/lib/greenwood/sigil/types";

export {
  GREENWOOD_FIRE_ACTIVE_TIMEOUT_MS,
  GREENWOOD_FIRE_HEARTBEAT_MS,
  GREENWOOD_FIRE_PRESENCE_REFRESH_MS,
} from "@/lib/greenwood/presence/constants";

export type {
  FirePresenceMember,
  FirePresenceSelfState,
  FirePresenceSnapshot,
} from "@/lib/greenwood/presence/types";

// Server-only status / admission / sigil / presence:
// import modules directly from trusted server code.
