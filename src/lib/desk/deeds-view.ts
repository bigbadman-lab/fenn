/**
 * Desk Deeds workspace view selection.
 * Only `submissions` is special; everything else falls back to definitions.
 */
export type DeskDeedsView = "definitions" | "submissions";

export function parseDeskDeedsView(
  raw: string | string[] | null | undefined,
): DeskDeedsView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "submissions" ? "submissions" : "definitions";
}
