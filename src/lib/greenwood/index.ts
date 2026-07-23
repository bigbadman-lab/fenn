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
  GREENWOOD_MEMBER_PATHS,
  memberInteriorCopy,
} from "@/lib/greenwood/member-paths";

// Server-only status / admission: import modules directly from trusted server code.
