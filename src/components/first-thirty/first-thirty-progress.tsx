"use client";

import Link from "next/link";

import {
  FIRST_THIRTY_CHECKLIST,
  firstThirtyThresholdTotal,
} from "@/lib/first-thirty/copy";
import {
  FIRST_THIRTY_DEEDS_HREF,
  FIRST_THIRTY_GREENWOOD_HREF,
} from "@/lib/first-thirty/presentation";
import type { SafeFirstThirtyProgress } from "@/lib/first-thirty/types";

type FirstThirtyProgressPanelProps = {
  progress: SafeFirstThirtyProgress;
  /** denser line for compact headers */
  variant?: "panel" | "compact" | "deeds";
};

/**
 * Trusted First Thirty checklist — only when path is active.
 * Uses lifetime LEAF from the server, not assumed +10 per mark.
 */
export function FirstThirtyProgressPanel({
  progress,
  variant = "panel",
}: FirstThirtyProgressPanelProps) {
  if (progress.greenwoodOpen) {
    return (
      <div className="ft-progress ft-progress--open">
        <p className="ft-progress__title">THE GREENWOOD IS OPEN</p>
        <p className="ft-progress__cta">
          <Link href={FIRST_THIRTY_GREENWOOD_HREF} className="btn-text">
            [ WALK TO THE GREENWOOD ]
          </Link>
        </p>
      </div>
    );
  }

  if (!progress.active) {
    return null;
  }

  const total = firstThirtyThresholdTotal(progress);
  const lifetime = Math.max(0, Math.trunc(progress.lifetimeLeaf));
  const until = Math.max(0, Math.trunc(progress.leafUntilGreenwood));

  if (variant === "compact") {
    return (
      <p className="ft-progress ft-progress--compact muted">
        FIRST THIRTY · {lifetime} / {total || 30}
      </p>
    );
  }

  const marks = [
    {
      done: progress.milestones.firstCamp,
      label: FIRST_THIRTY_CHECKLIST.firstCamp,
    },
    {
      done: progress.milestones.thirdCamp,
      label: FIRST_THIRTY_CHECKLIST.thirdCamp,
    },
    {
      done: progress.milestones.firstDeed,
      label: FIRST_THIRTY_CHECKLIST.firstDeed,
    },
  ];

  return (
    <div
      className={
        variant === "deeds"
          ? "ft-progress ft-progress--deeds"
          : "ft-progress"
      }
      aria-label="The First Thirty"
    >
      <p className="ft-progress__title">THE FIRST THIRTY</p>
      <p className="ft-progress__leaf">
        {lifetime} / {total || 30} LEAF
      </p>
      <ul className="ft-progress__list">
        {marks.map((m) => (
          <li key={m.label} className="ft-progress__item">
            <span className="ft-progress__mark" aria-hidden="true">
              {m.done ? "[x]" : "[ ]"}
            </span>
            <span>
              <span className="visually-hidden">
                {m.done ? "completed: " : "not yet: "}
              </span>
              {m.label}
            </span>
          </li>
        ))}
      </ul>
      {progress.nextMilestone === "first_deed" ? (
        <div className="ft-progress__next">
          <p>Offer a Deed to the world.</p>
          <p className="muted">
            The Greenwood opens when it is witnessed.
          </p>
          <p>
            <Link href={FIRST_THIRTY_DEEDS_HREF} className="btn-text">
              [ FIND A DEED ]
            </Link>
          </p>
        </div>
      ) : null}
      {until > 0 && progress.nextMilestone !== "first_deed" ? (
        <p className="muted ft-progress__until">
          {until} MORE UNTIL THE GREENWOOD OPENS
        </p>
      ) : null}
    </div>
  );
}
