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
} from "@/lib/greenwood/fire-message";

export type { SafeGreenwoodSigil } from "@/lib/greenwood/sigil/types";

// Server-only status / admission / sigil assignment:
// import modules directly from trusted server code.
