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
