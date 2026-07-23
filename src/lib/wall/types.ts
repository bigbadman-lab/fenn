export type WallSourceType = "bootstrap" | "system" | "x_agent";

/**
 * Public Wall inscription — FENN speaks; provenance stays internal.
 * markCount is aggregate only — never who marked.
 */
export type PublicWallEntry = {
  id: string;
  body: string;
  createdAt: string;
  markCount: number;
};

export type LeaveWallMarkStatus = "marked" | "already_marked";

export type LeaveWallMarkResult = {
  status: LeaveWallMarkStatus;
  count: number;
};

export type WriteFennWallEntryInput = {
  body: string;
  sourceType: WallSourceType;
  sourceExternalId?: string | null;
};

export type WriteFennWallEntryResult = {
  created: boolean;
  entry: PublicWallEntry;
};

export const WALL_BODY_MAX_CHARS = 4000;
export const WALL_SOURCE_EXTERNAL_ID_MAX_CHARS = 256;
export const PUBLIC_WALL_ENTRIES_DEFAULT_LIMIT = 30;
export const PUBLIC_WALL_ENTRIES_MAX_LIMIT = 100;

export const WALL_SOURCE_TYPES = [
  "bootstrap",
  "system",
  "x_agent",
] as const satisfies readonly WallSourceType[];
