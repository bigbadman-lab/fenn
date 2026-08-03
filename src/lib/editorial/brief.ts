import type {
  EditorialBrief,
  EditorialRobinhoodContext,
  EditorialWorldContext,
} from "@/lib/editorial/types";

/**
 * Compact deterministic editorial brief from trusted contexts.
 * Internal only — never published as a transmission body.
 */
export function buildEditorialBrief(
  world: EditorialWorldContext,
  robinhood: EditorialRobinhoodContext,
): EditorialBrief {
  const themes: string[] = [];

  if (world.greenwoodAdmissions > 0) {
    themes.push("Greenwood is growing.");
  }
  if (world.newOutlaws > 0) {
    themes.push("Builders and Outlaws are arriving.");
  }
  if (world.deedSubmissionsApproved > 0 || world.deedsCreated > 0) {
    themes.push("Deeds mark real work.");
  }
  if (world.campMessages > 0) {
    themes.push("The Camp still speaks.");
  }
  if (world.wallInscriptions > 0) {
    themes.push("The Wall carries new marks.");
  }
  if (world.book.written) {
    themes.push("The Book has been written for this day.");
  }
  if (robinhood.hasTrustedSignals) {
    themes.push("Robinhood Chain feels active enough to notice.");
  }
  if (world.quiet) {
    themes.push("A quiet day. Stillness is allowed.");
  } else {
    themes.push("FENN feels alive.");
  }
  if (themes.length < 2) {
    themes.push("Quiet optimism.");
  }

  const avoid = [
    "hype",
    "price discussion",
    "generic crypto clichés",
    "hashtags",
    "emojis",
    "GM greetings",
    "marketing speak",
    "fake partnerships",
    "invented statistics",
  ];

  return {
    themes: themes.slice(0, 8),
    avoid,
  };
}
