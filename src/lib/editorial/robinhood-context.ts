import "server-only";

import type { EditorialRobinhoodContext } from "@/lib/editorial/types";
import type { EditorialWorldContext } from "@/lib/editorial/types";

/**
 * Robinhood Chain ecosystem awareness for editorial operators.
 *
 * This is NOT a news wire. No fabricated launches, partnerships, or prices.
 * Uses only public treasury/world signals already available to FENN.
 */
export function buildEditorialRobinhoodContext(
  world: EditorialWorldContext,
): EditorialRobinhoodContext {
  const lines: string[] = [];

  if (world.treasuryState === "ready") {
    lines.push("Public Treasury on Robinhood Chain is readable.");
  } else if (world.treasuryState === "unconfigured") {
    lines.push("Treasury is not configured for public readout today.");
  } else {
    lines.push("Treasury readout is unavailable today.");
  }

  if (world.commonsState === "ready") {
    lines.push("Commons commitments can be observed publicly.");
  }

  if (world.commonsAllocationEvents > 0) {
    lines.push(
      `Commons allocation events observed today: ${world.commonsAllocationEvents}.`,
    );
  }

  if (world.leafRecognitionEvents > 0) {
    lines.push(
      `LEAF recognition events today: ${world.leafRecognitionEvents} (world economy, not price).`,
    );
  }

  if (lines.length === 0) {
    lines.push("No additional curated Robinhood ecosystem notes today.");
  }

  lines.push(
    "Do not invent launches, roadmap claims, partnerships, or dollar prices.",
  );

  return {
    hasTrustedSignals:
      world.treasuryState === "ready" ||
      world.commonsAllocationEvents > 0 ||
      world.leafRecognitionEvents > 0,
    lines,
    caution: "summarise only; never invent announcements or partnerships",
  };
}
