export {
  ALL_GREENWOOD_SIGIL_DEFINITIONS,
  CURATED_GREENWOOD_SIGILS,
  GREENWOOD_SIGIL_MAX_HEIGHT,
  GREENWOOD_SIGIL_MAX_WIDTH,
  GREENWOOD_SIGIL_MIN_HEIGHT,
  UNMARKED_SIGIL,
  UNMARKED_SIGIL_ID,
  assertSigilGeometry,
  type GreenwoodSigilDefinition,
} from "@/lib/greenwood/sigil/catalogue";

export type {
  AssignGreenwoodSigilRpcRow,
  GreenwoodSigilAssignmentResult,
  SafeGreenwoodSigil,
} from "@/lib/greenwood/sigil/types";

// Server-only assignment helpers: import from assignment.ts in trusted server code.
