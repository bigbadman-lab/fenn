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

export {
  CURRENT_SIGIL_CATALOGUE_RELATION,
  PREVIOUS_SIGIL_CATALOGUE_RELATION,
  DESK_CURRENT_SIGIL_MARK_SELECT,
  DESK_CURRENT_SIGIL_SLUG_SELECT,
  PRESENCE_CURRENT_SIGIL_SELECT,
  PROFILE_CURRENT_SIGIL_SELECT,
  currentSigilCatalogueEmbed,
  previousSigilCatalogueEmbed,
} from "@/lib/greenwood/sigil/embeds";

export type {
  AssignGreenwoodSigilRpcRow,
  GreenwoodSigilAssignmentResult,
  SafeGreenwoodSigil,
} from "@/lib/greenwood/sigil/types";

// Server-only assignment helpers: import from assignment.ts in trusted server code.
