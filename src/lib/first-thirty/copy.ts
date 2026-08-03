/**
 * Member-facing copy for THE FIRST THIRTY presentation.
 * Economics live in the backend; strings here never invent LEAF totals.
 */

export const FIRST_THIRTY_CHECKLIST = {
  firstCamp: "THE FIRE HEARD YOU",
  thirdCamp: "THE GREENWOOD REMEMBERED",
  firstDeed: "A DEED MUST BE WITNESSED",
} as const;

export const FIRST_THIRTY_REVEAL_TITLE = {
  camp_first: "THE FIRE LEFT SOMETHING BEHIND",
  camp_three: "THE GREENWOOD REMEMBERED",
  first_deed_grant: "THE GREENWOOD HAS OPENED",
  first_deed_zero: "THE GREENWOOD HAS OPENED",
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
