"use client";

import Link from "next/link";

import {
  firstThirtyChecklistMarks,
  firstThirtyThresholdTotal,
} from "@/lib/first-thirty/copy";
import {
  FIRST_THIRTY_DEEDS_HREF,
  FIRST_THIRTY_GREENWOOD_HREF,
  FIRST_THIRTY_JOURNEY_COPY,
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
        <p className="ft-progress__open-body">
          {FIRST_THIRTY_JOURNEY_COPY.openBody}
        </p>
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
  const marks = firstThirtyChecklistMarks(progress.milestones);

  if (variant === "compact") {
    return (
      <p className="ft-progress ft-progress--compact muted">
        FIRST THIRTY · {lifetime} / {total || 30}
      </p>
    );
  }

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
          <li
            key={m.key}
            className="ft-progress__item"
            aria-label={m.done ? `${m.label}, complete` : `${m.label}, incomplete`}
          >
            <span className="ft-progress__mark" aria-hidden="true">
              {m.done ? "[x]" : "[ ]"}
            </span>
            <span>{m.label}</span>
          </li>
        ))}
      </ul>
      {progress.nextMilestone === "first_deed" ? (
        <div className="ft-progress__next">
          <p>{FIRST_THIRTY_JOURNEY_COPY.offerDeed}</p>
          <p className="muted">{FIRST_THIRTY_JOURNEY_COPY.deedOpensGreenwood}</p>
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
