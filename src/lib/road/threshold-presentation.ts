/**
 * Book of the Road — reusable presentation for earned-place thresholds.
 * Pure helpers only. No React. No hardcoded Greenwood threshold.
 */

export type EarnedPlaceStanding = {
  /** Lifetime standing used for the place's law (not spendable balance). */
  current: number;
  /** Configured requirement for this place. */
  required: number;
  /** Max(0, required − current). */
  remaining: number;
};

/** Standard continuum when refused or not yet named. */
export const ROAD_THRESHOLD_CONTINUATIONS = {
  camp: { href: "/camp", label: "[ GO TO CAMP ]" },
  deeds: { href: "/deeds", label: "[ FIND A DEED ]" },
  map: { href: "/#the-map", label: "[ RETURN TO THE MAP ]" },
  register: { href: "/#outlaw-register", label: "[ CLAIM A NAME ]" },
  claimName: { href: "/#outlaw-register", label: "[ CLAIM A NAME ]" },
} as const;

export function standingFromLifetimeAndThreshold(
  lifetimeLeaf: number,
  threshold: number,
): EarnedPlaceStanding {
  const current = Math.max(0, Math.trunc(lifetimeLeaf));
  const required = Math.max(0, Math.trunc(threshold));
  return {
    current,
    required,
    remaining: Math.max(0, required - current),
  };
}

/** e.g. "12 / 30 LEAF" — never invents required if not provided elsewhere. */
export function formatStandingFraction(standing: EarnedPlaceStanding): string {
  return `${standing.current} / ${standing.required} LEAF`;
}

/** e.g. "18 remain." */
export function formatStandingRemainLine(standing: EarnedPlaceStanding): string {
  if (standing.remaining === 1) return "1 remains.";
  return `${standing.remaining} remain.`;
}

/** Law line: "Standing required: N LEAF" */
export function formatStandingRequiredLaw(required: number): string {
  return `Standing required: ${Math.max(0, Math.trunc(required))} LEAF`;
}
