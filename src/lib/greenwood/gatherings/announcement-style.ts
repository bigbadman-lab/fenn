/**
 * Gathering announcement styles (no migration — stored in metadata).
 * Invalid/missing values resolve to quiet.
 */

export const GATHERING_ANNOUNCEMENT_STYLES = ["quiet", "fire_calling"] as const;

export type GatheringAnnouncementStyle =
  (typeof GATHERING_ANNOUNCEMENT_STYLES)[number];

export const DEFAULT_GATHERING_ANNOUNCEMENT_STYLE: GatheringAnnouncementStyle =
  "quiet";

export function parseGatheringAnnouncementStyle(
  value: unknown,
): GatheringAnnouncementStyle {
  if (value === "quiet" || value === "fire_calling") return value;
  return DEFAULT_GATHERING_ANNOUNCEMENT_STYLE;
}

export function announcementStyleFromMetadata(
  metadata: unknown,
): GatheringAnnouncementStyle {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return DEFAULT_GATHERING_ANNOUNCEMENT_STYLE;
  }
  const raw = (metadata as Record<string, unknown>).announcementStyle;
  return parseGatheringAnnouncementStyle(raw);
}

/** Merge style into existing metadata without inventing channel flags. */
export function metadataWithAnnouncementStyle(
  existing: Record<string, unknown> | null | undefined,
  style: GatheringAnnouncementStyle,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...existing }
      : {};
  return {
    ...base,
    announcementStyle: style,
  };
}

export function gatheringAnnouncementStyleLabel(
  style: GatheringAnnouncementStyle,
): string {
  switch (style) {
    case "fire_calling":
      return "The Fire Calls";
    case "quiet":
    default:
      return "Quiet Notice";
  }
}
