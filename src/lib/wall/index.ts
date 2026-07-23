export type {
  LeaveWallMarkResult,
  LeaveWallMarkStatus,
  PublicWallEntry,
  WallSourceType,
  WriteFennWallEntryInput,
  WriteFennWallEntryResult,
} from "@/lib/wall/types";

export {
  PUBLIC_WALL_ENTRIES_DEFAULT_LIMIT,
  PUBLIC_WALL_ENTRIES_MAX_LIMIT,
  WALL_BODY_MAX_CHARS,
  WALL_SOURCE_EXTERNAL_ID_MAX_CHARS,
  WALL_SOURCE_TYPES,
} from "@/lib/wall/types";

export { WallError, type WallErrorCode } from "@/lib/wall/errors";

export { formatWallInscriptionTime } from "@/lib/wall/format";

export { toPublicWallEntry } from "@/lib/wall/read";

export {
  FOUNDING_WALL_INSCRIPTION_BODY,
  FOUNDING_WALL_SOURCE_EXTERNAL_ID,
  foundingWallWriteInput,
} from "@/lib/wall/bootstrap";

export {
  STAGE12_WALL_MODEL_FORBIDDEN_FIELDS,
  STAGE12_WALL_SAFETY_REQUIREMENTS,
  STAGE12_WRITE_TO_WALL_TOOL,
  stage12WallSourceExternalId,
  stage12WallWriteInput,
  wallPermalinkAbsolute,
  wallPermalinkPath,
  type Stage12WriteToWallArgs,
} from "@/lib/wall/stage12-tool-contract";

// Server-only read/write/marks: import from @/lib/wall/read, write, or marks
// in trusted server modules only. Client helpers: @/lib/wall/client.
