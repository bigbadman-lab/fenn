/**
 * Member-facing copy for THE FIRST THIRTY presentation.
 * Economics live in the backend; strings here never invent LEAF totals.
 *
 * Checklist marks [x]/[ ] communicate completion. Incomplete labels use
 * active wording; completed labels use past recognition. No fourth Greenwood
 * milestone — open is a consequence of the path / threshold.
 */

import { CANOPY_DISPLAY } from "@/lib/site/world-vocabulary";

export type FirstThirtyMilestoneCopy = {
  incomplete: string;
  completed: string;
};

/**
 * Source of truth for the three First Thirty checklist labels.
 * Keys align with SafeFirstThirtyProgress.milestones (presentation names).
 */
export const FIRST_THIRTY_MILESTONE_LABELS = {
  firstCamp: {
    incomplete: "SPEAK SO THE FIRE MAY HEAR YOU",
    completed: "THE FIRE HEARD YOU",
  },
  thirdCamp: {
    incomplete: "LET YOUR WORDS CARRY FURTHER",
    completed: "YOUR WORDS WERE KEPT",
  },
  firstDeed: {
    incomplete: "A DEED MUST BE WITNESSED",
    completed: "A DEED WAS WITNESSED",
  },
} as const satisfies Record<
  "firstCamp" | "thirdCamp" | "firstDeed",
  FirstThirtyMilestoneCopy
>;

/**
 * Completed-state checklist titles (historical single-string map).
 * Prefer firstThirtyChecklistMarkLabel() for state-aware UI.
 */
export const FIRST_THIRTY_CHECKLIST = {
  firstCamp: FIRST_THIRTY_MILESTONE_LABELS.firstCamp.completed,
  thirdCamp: FIRST_THIRTY_MILESTONE_LABELS.thirdCamp.completed,
  firstDeed: FIRST_THIRTY_MILESTONE_LABELS.firstDeed.completed,
} as const;

export type FirstThirtyChecklistKey = keyof typeof FIRST_THIRTY_MILESTONE_LABELS;

/** Active vs complete label for a trusted milestone flag. */
export function firstThirtyChecklistMarkLabel(
  key: FirstThirtyChecklistKey,
  done: boolean,
): string {
  const copy = FIRST_THIRTY_MILESTONE_LABELS[key];
  return done ? copy.completed : copy.incomplete;
}

export type FirstThirtyChecklistMark = {
  key: FirstThirtyChecklistKey;
  done: boolean;
  label: string;
};

/** Ordered checklist for home, outlaw, and CAMP. Never includes Greenwood. */
export function firstThirtyChecklistMarks(milestones: {
  firstCamp: boolean;
  thirdCamp: boolean;
  firstDeed: boolean;
}): FirstThirtyChecklistMark[] {
  return (
    [
      "firstCamp",
      "thirdCamp",
      "firstDeed",
    ] as const
  ).map((key) => {
    const done = milestones[key];
    return {
      key,
      done,
      label: firstThirtyChecklistMarkLabel(key, done),
    };
  });
}

/**
 * Direct event acknowledgements (Camp reveal / celebration headers).
 * first_deed consequences use REVEAL titles when Greenwood opens.
 */
export const FIRST_THIRTY_REVEAL_TITLE = {
  camp_first: "THE FIRE LEFT SOMETHING BEHIND",
  camp_three: "YOUR WORDS WERE KEPT",
  /** Event line when a Deed is finalised. */
  first_deed_witnessed: "A DEED WAS WITNESSED",
  /** Consequence when trusted state opens Greenwood. */
  first_deed_greenwood_open: CANOPY_DISPLAY.hasOpened,
  /** @deprecated Prefer first_deed_greenwood_open */
  first_deed_grant: CANOPY_DISPLAY.hasOpened,
  /** @deprecated Prefer first_deed_greenwood_open */
  first_deed_zero: CANOPY_DISPLAY.hasOpened,
} as const;

export function firstThirtyThresholdTotal(progress: {
  lifetimeLeaf: number;
  leafUntilGreenwood: number;
}): number {
  return Math.max(
    0,
    Math.trunc(progress.lifetimeLeaf) + Math.trunc(progress.leafUntilGreenwood),
  );
}
