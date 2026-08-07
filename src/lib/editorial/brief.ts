import type {
  EditorialBrief,
  EditorialContextPack,
  EditorialRobinhoodContext,
  EditorialWorldContext,
} from "@/lib/editorial/types";

const DEFAULT_AVOID = [
  "hype",
  "price discussion",
  "generic crypto clichés",
  "hashtags",
  "emojis",
  "GM greetings",
  "marketing speak",
  "fake partnerships",
  "invented statistics",
  "platform/ecosystem language",
  "repeating recentWriting",
] as const;

/**
 * Compact editorial brief from context pack.
 * Evidence only — no slogan conversions of counts.
 */
export function buildEditorialBriefFromPack(
  pack: EditorialContextPack,
): EditorialBrief {
  const themes = pack.newsroom.headlines
    .slice(0, 8)
    .map((h) => h.headline);

  if (themes.length === 0 && pack.newsroom.quiet) {
    themes.push("Quiet day — no fabricated busyness.");
  }

  return {
    themes,
    avoid: [...DEFAULT_AVOID],
    whatMattersToday: pack.editorialFocus.whatMattersToday,
    recoveryUsed: false,
  };
}

/**
 * @deprecated Prefer buildEditorialBriefFromPack. Kept for tests calling the old shape.
 * Does not invent growth slogans from counts.
 */
export function buildEditorialBrief(
  world: EditorialWorldContext,
  _robinhood: EditorialRobinhoodContext,
  whatMattersToday?: string | null,
): EditorialBrief {
  const themes: string[] = [];
  if (world.quiet) {
    themes.push("Quiet day — no fabricated busyness.");
  } else {
    themes.push("Activity present in day counts — consult newsroom for detail.");
  }
  return {
    themes,
    avoid: [...DEFAULT_AVOID],
    whatMattersToday: whatMattersToday?.trim() || null,
    recoveryUsed: false,
  };
}
