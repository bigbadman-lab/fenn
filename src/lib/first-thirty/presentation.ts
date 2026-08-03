/**
 * Pure First Thirty presentation logic — no network, no LEAF mutation.
 * UI components call these so tests can prove trusted-only behaviour.
 */

import { firstThirtyThresholdTotal } from "@/lib/first-thirty/copy";
import type {
  FirstThirtyMilestoneEvent,
  SafeFirstThirtyProgress,
} from "@/lib/first-thirty/types";

export const FIRST_THIRTY_GREENWOOD_HREF = "/greenwood?crossing=1";
export const FIRST_THIRTY_DEEDS_HREF = "/deeds";

export const FIRST_THIRTY_FAILURE_COPY = {
  line1: "The words remain.",
  line2: "The LEAF could not be counted just now.",
} as const;

export const FIRST_THIRTY_INELIGIBLE_COPY = "Not every word leaves a mark.";

export const FIRST_THIRTY_DEEDS_COPY = {
  oneDeedRemains: "ONE DEED REMAINS",
  beforeWitness:
    "A Deed must be witnessed before it carries weight.",
  beforeSubmit:
    "Offer something real. The Greenwood will not count an empty gesture.",
  pendingWitness: "YOUR DEED IS WAITING TO BE WITNESSED",
  pathInactive:
    "LEAF may still be found through Camp and Deeds.",
} as const;

/** Active checklist only — never for completed, Greenwood, or unauthenticated null. */
export function shouldShowActiveFirstThirty(
  progress: SafeFirstThirtyProgress | null | undefined,
): boolean {
  return Boolean(progress?.active && !progress.greenwoodOpen);
}

/** Greenwood-open action without checklist. */
export function shouldShowGreenwoodOpenAction(
  progress: SafeFirstThirtyProgress | null | undefined,
): boolean {
  return Boolean(progress?.greenwoodOpen);
}

export function formatFirstThirtyLeafLine(
  progress: Pick<SafeFirstThirtyProgress, "lifetimeLeaf" | "leafUntilGreenwood">,
): string {
  const total = firstThirtyThresholdTotal(progress) || 30;
  const lifetime = Math.max(0, Math.trunc(progress.lifetimeLeaf));
  return `${lifetime} / ${total} LEAF`;
}

export function formatCompactFirstThirtyLine(
  progress: Pick<SafeFirstThirtyProgress, "lifetimeLeaf" | "leafUntilGreenwood">,
): string {
  const total = firstThirtyThresholdTotal(progress) || 30;
  const lifetime = Math.max(0, Math.trunc(progress.lifetimeLeaf));
  return `FIRST THIRTY · ${lifetime} / ${total}`;
}

/**
 * Quiet progress after an eligible exchange that did not newly satisfy a milestone.
 * Count is trusted server `eligibleCampExchanges` only.
 */
export function formatEligibleExchangeQuiet(
  progress: SafeFirstThirtyProgress,
): string | null {
  if (!progress.exchangeCounted) return null;
  if (progress.lastEvent?.newlySatisfied) return null;
  if (!progress.active && !progress.greenwoodOpen) return null;

  const n = Math.max(0, Math.trunc(progress.eligibleCampExchanges));
  if (n <= 0) return null;

  if (n === 2 && !progress.milestones.thirdCamp) {
    return "ONE MEANINGFUL EXCHANGE REMAINS";
  }

  if (n >= 1 && n < 3 && !progress.milestones.thirdCamp) {
    return `THE FIRE KEPT YOUR WORDS\n${n} / 3 MEANINGFUL EXCHANGES`;
  }

  return null;
}

/**
 * Session key for one-shot reveal. Assistant message id is preferred.
 * Never uses raw message counts.
 */
export function firstThirtyEventSessionKey(input: {
  messageId?: string | null;
  event: FirstThirtyMilestoneEvent;
  lifetimeLeaf: number;
}): string {
  const base =
    input.messageId?.trim() ||
    `${input.event.milestone}:${input.event.actualGrant}:${input.lifetimeLeaf}`;
  return `ft:${base}:${input.event.milestone}`;
}

export function shouldAnnounceFirstThirtyEvent(input: {
  event: FirstThirtyMilestoneEvent | null | undefined;
  eventKey: string;
  seenKeys: ReadonlySet<string>;
}): boolean {
  if (!input.event?.newlySatisfied) return false;
  if (input.seenKeys.has(input.eventKey)) return false;
  return true;
}

/** Never show +0 LEAF. */
export function formatActualLeafGrantLine(actualGrant: number): string | null {
  const n = Math.trunc(actualGrant);
  if (n <= 0) return null;
  return `+${n} LEAF`;
}

/**
 * Synthesize a first_deed event when status transitions after approval refresh
 * (no live lastEvent from GET). Uses ledger-backed firstDeed grant only.
 */
export function firstDeedEventFromTransition(input: {
  previous: SafeFirstThirtyProgress | null;
  next: SafeFirstThirtyProgress;
}): FirstThirtyMilestoneEvent | null {
  const was = input.previous?.milestones.firstDeed === true;
  const now = input.next.milestones.firstDeed === true;
  if (was || !now) return null;
  if (input.previous === null) {
    // First fetch already complete — do not invent a celebration.
    return null;
  }

  const actualGrant = Math.max(
    0,
    Math.trunc(input.next.milestoneGrants?.firstDeed ?? 0),
  );

  return {
    milestone: "first_deed",
    newlySatisfied: true,
    nominalGrant: 10,
    actualGrant,
    greenwoodOpen: input.next.greenwoodOpen,
  };
}

export function isFirstThirtyPathInactiveBelowOpen(
  progress: SafeFirstThirtyProgress | null | undefined,
): boolean {
  if (!progress) return false;
  if (progress.greenwoodOpen) return false;
  if (progress.active) return false;
  return progress.terminated || progress.completed;
}

export const FIRST_THIRTY_CAMP_HREF = "/camp";

export const FIRST_THIRTY_PRINCIPLE = {
  line1: "Every Outlaw remembers the first thirty leaves.",
  line2: "They are not earned for greatness.",
  line3: "They are earned for arriving.",
} as const;

export const FIRST_THIRTY_JOURNEY_COPY = {
  eyebrow: "YOUR JOURNEY",
  title: "THE FIRST THIRTY",
  loading: "the road is being read...",
  fetchFail: "The road cannot be read just now.",
  fetchFailAside: "Camp and Deeds remain open.",
  openTitle: "THE GREENWOOD IS OPEN",
  openBody: "The road no longer ends here.",
  nextLabel: "NEXT",
  nextStepLabel: "NEXT STEP",
  zeroNext: "The road begins in Camp.",
  pathInactive: FIRST_THIRTY_DEEDS_COPY.pathInactive,
  visitCamp: "[ VISIT CAMP ]",
  visitDeeds: "[ VISIT DEEDS ]",
  goToCamp: "[ GO TO CAMP ]",
  returnToCamp: "[ RETURN TO CAMP ]",
  findADeed: "[ FIND A DEED ]",
  walkToGreenwood: "[ WALK TO THE GREENWOOD ]",
  continueJourney: "[ CONTINUE THE JOURNEY ]",
} as const;

export type FirstThirtyPrimaryAction = {
  href: string;
  label: string;
};

/** Distinct responsibilities for home / outlaw composition. */
export type FirstThirtyJourneyPresentation = {
  /** What The First Thirty means (principle) — not progress status. */
  bodyLines: string[];
  /** Label for the action block, or null when no separate NEXT block. */
  nextLabel: string | null;
  /** Immediate next action only — never the same lines as bodyLines. */
  nextDescription: string[];
  action: FirstThirtyPrimaryAction | null;
  /** Empty checklist hidden for zero-progress homepage orientation. */
  showMilestoneList: boolean;
};

/**
 * Primary CTA from trusted nextMilestone / greenwoodOpen only.
 * Never from raw LEAF balance.
 */
export function firstThirtyPrimaryAction(
  progress: SafeFirstThirtyProgress,
): FirstThirtyPrimaryAction | null {
  if (progress.greenwoodOpen) {
    return {
      href: FIRST_THIRTY_GREENWOOD_HREF,
      label: FIRST_THIRTY_JOURNEY_COPY.walkToGreenwood,
    };
  }
  if (!progress.active) return null;

  switch (progress.nextMilestone) {
    case "first_camp":
      return {
        href: FIRST_THIRTY_CAMP_HREF,
        label: FIRST_THIRTY_JOURNEY_COPY.goToCamp,
      };
    case "third_camp":
      return {
        href: FIRST_THIRTY_CAMP_HREF,
        label: FIRST_THIRTY_JOURNEY_COPY.returnToCamp,
      };
    case "first_deed":
      return {
        href: FIRST_THIRTY_DEEDS_HREF,
        label: FIRST_THIRTY_JOURNEY_COPY.findADeed,
      };
    default:
      return null;
  }
}

/**
 * Immediate next-step description only.
 * Must not repeat checklist status titles or principle body.
 */
export function firstThirtyNextDescription(
  progress: SafeFirstThirtyProgress,
  surface: "home" | "outlaw" = "home",
): string[] {
  if (progress.greenwoodOpen) {
    // Greenwood open is a self-explanatory block — no NEXT section.
    return [];
  }
  if (!progress.active) {
    if (isFirstThirtyPathInactiveBelowOpen(progress)) {
      return [FIRST_THIRTY_JOURNEY_COPY.pathInactive];
    }
    return [];
  }

  switch (progress.nextMilestone) {
    case "first_camp":
      return [FIRST_THIRTY_JOURNEY_COPY.zeroNext];
    case "third_camp": {
      const done = Math.max(0, Math.trunc(progress.eligibleCampExchanges));
      const remain = Math.max(0, 3 - done);
      if (progress.milestones.firstCamp && remain > 0) {
        return [
          remain === 1
            ? "One meaningful exchange remains."
            : `${remain} meaningful exchanges remain.`,
        ];
      }
      return ["Speak again in Camp."];
    }
    case "first_deed":
      if (surface === "outlaw") {
        return [
          "Offer a Deed to the world.",
          "The Greenwood opens when it is witnessed.",
        ];
      }
      return ["Offer a Deed to the world."];
    default:
      return [];
  }
}

/**
 * @deprecated Prefer firstThirtyNextDescription — kept as thin alias for tests/callers.
 */
export function firstThirtyNextStepLines(
  progress: SafeFirstThirtyProgress,
): string[] {
  return firstThirtyNextDescription(progress, "home");
}

/**
 * Full orientation presentation with non-overlapping body vs next copy.
 */
export function firstThirtyJourneyPresentation(
  progress: SafeFirstThirtyProgress,
  surface: "home" | "outlaw",
): FirstThirtyJourneyPresentation {
  const principle = [
    FIRST_THIRTY_PRINCIPLE.line1,
    FIRST_THIRTY_PRINCIPLE.line2,
    FIRST_THIRTY_PRINCIPLE.line3,
  ];

  const zeroStart =
    progress.active &&
    progress.nextMilestone === "first_camp" &&
    !progress.milestones.firstCamp;

  // Homepage zero: orient with principle + single next line (no empty checklist).
  // Outlaw: always show checklist for personal journey record.
  const showMilestoneList = surface === "outlaw" ? true : !zeroStart;

  // Home desktop always shows principle when active; mobile CSS may hide it.
  const bodyLines =
    progress.active || progress.greenwoodOpen ? principle : [];

  const nextDescription = firstThirtyNextDescription(progress, surface);
  const action = firstThirtyPrimaryAction(progress);

  let nextLabel: string | null = null;
  if (progress.greenwoodOpen) {
    nextLabel = null;
  } else if (nextDescription.length > 0 || action) {
    nextLabel =
      surface === "home"
        ? FIRST_THIRTY_JOURNEY_COPY.nextLabel
        : FIRST_THIRTY_JOURNEY_COPY.nextStepLabel;
  }

  return {
    bodyLines,
    nextLabel,
    nextDescription,
    action,
    showMilestoneList,
  };
}

/** Compact homepage “NEXT:” single line when space is tight. */
export function firstThirtyCompactNextLine(
  progress: SafeFirstThirtyProgress,
): string | null {
  if (progress.greenwoodOpen) return null;
  if (!progress.active) return null;
  switch (progress.nextMilestone) {
    case "first_camp":
      return "GO TO CAMP";
    case "third_camp":
      return "RETURN TO CAMP";
    case "first_deed":
      return "FIND A DEED";
    default:
      return null;
  }
}

/**
 * Whether homepage / outlaw show any First Thirty block for a registered
 * profile. Greenwood members (entered) hide permanently.
 */
export function shouldShowFirstThirtyJourneySurface(input: {
  authenticated: boolean;
  registered: boolean;
  greenwoodMember: boolean;
}): boolean {
  return (
    input.authenticated &&
    input.registered &&
    !input.greenwoodMember
  );
}
