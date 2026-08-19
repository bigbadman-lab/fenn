"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { FIRST_THIRTY_REVEAL_TITLE } from "@/lib/first-thirty/copy";
import {
  FIRST_THIRTY_DEEDS_HREF,
  FIRST_THIRTY_GREENWOOD_HREF,
  FIRST_THIRTY_JOURNEY_COPY,
  formatActualLeafGrantLine,
} from "@/lib/first-thirty/presentation";
import type {
  FirstThirtyMilestoneEvent,
  SafeFirstThirtyProgress,
} from "@/lib/first-thirty/types";

type FirstThirtyAcknowledgeProps = {
  event: FirstThirtyMilestoneEvent;
  /** Trusted progress after the event */
  progress: SafeFirstThirtyProgress;
  eventKey: string;
};

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * One-shot milestone reveal for a newlySatisfied event.
 * Staged CSS reveal; reduced-motion shows the full result immediately.
 * Replay suppressed by eventKey in parent session set.
 *
 * Distinguishes event (Deed witnessed) from consequence (Greenwood open)
 * and only shows LEAF lines when actualGrant > 0.
 */
export function FirstThirtyAcknowledge({
  event,
  progress,
  eventKey,
}: FirstThirtyAcknowledgeProps) {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    () => true,
  );

  const actual = Math.max(0, Math.trunc(event.actualGrant));
  const lifetime = Math.max(0, Math.trunc(progress.lifetimeLeaf));
  const until = Math.max(0, Math.trunc(progress.leafUntilGreenwood));
  const total = lifetime + until || 30;
  const greenwoodOpen = event.greenwoodOpen || progress.greenwoodOpen;
  const grantLine = formatActualLeafGrantLine(actual);

  let title: string = FIRST_THIRTY_REVEAL_TITLE.camp_first;
  if (event.milestone === "camp_three") {
    title = FIRST_THIRTY_REVEAL_TITLE.camp_three;
  } else if (event.milestone === "first_deed") {
    title = greenwoodOpen
      ? FIRST_THIRTY_REVEAL_TITLE.first_deed_greenwood_open
      : FIRST_THIRTY_REVEAL_TITLE.first_deed_witnessed;
  }

  return (
    <div
      className={
        reducedMotion ? "ft-reveal ft-reveal--reduced" : "ft-reveal"
      }
      role="status"
      aria-live="polite"
      data-ft-event={eventKey}
    >
      <p className="ft-reveal__rule" aria-hidden="true">
        ================================
      </p>
      <p className="ft-reveal__title ft-reveal__step ft-reveal__step--1">
        {title}
      </p>

      {event.milestone === "first_deed" && greenwoodOpen ? (
        <p className="ft-reveal__witness ft-reveal__step ft-reveal__step--2">
          {FIRST_THIRTY_REVEAL_TITLE.first_deed_witnessed}
        </p>
      ) : null}

      {grantLine ? (
        <p className="ft-reveal__grant ft-reveal__step ft-reveal__step--2">
          +{actual} <span className="camp-leaf">LEAF</span>
        </p>
      ) : null}

      <p className="ft-reveal__total ft-reveal__step ft-reveal__step--3">
        {lifetime} / {total} LEAF
      </p>

      {event.milestone === "camp_first" && !greenwoodOpen && until > 0 ? (
        <p className="ft-reveal__next muted ft-reveal__step ft-reveal__step--4">
          {FIRST_THIRTY_JOURNEY_COPY.untilCanopyOpens(until)}
        </p>
      ) : null}

      {event.milestone === "camp_three" && !greenwoodOpen ? (
        <div className="ft-reveal__next ft-reveal__step ft-reveal__step--4">
          <p className="muted">
            {FIRST_THIRTY_JOURNEY_COPY.offerDeed}
            <br />
            {FIRST_THIRTY_JOURNEY_COPY.deedOpensGreenwood}
          </p>
          <p>
            <Link href={FIRST_THIRTY_DEEDS_HREF} className="btn-text">
              [ FIND A DEED ]
            </Link>
          </p>
        </div>
      ) : null}

      {(event.milestone === "first_deed" || greenwoodOpen) && greenwoodOpen ? (
        <div className="ft-reveal__next ft-reveal__step ft-reveal__step--4">
          <p>{FIRST_THIRTY_JOURNEY_COPY.openBody}</p>
          <p>
            <Link href={FIRST_THIRTY_GREENWOOD_HREF} className="btn-text">
              {FIRST_THIRTY_JOURNEY_COPY.walkToGreenwood}
            </Link>
          </p>
        </div>
      ) : null}

      <p className="ft-reveal__rule" aria-hidden="true">
        ================================
      </p>
    </div>
  );
}
