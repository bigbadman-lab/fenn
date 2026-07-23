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

// Server-only status / admission: import modules directly from trusted server code.
