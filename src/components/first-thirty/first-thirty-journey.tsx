"use client";

import Link from "next/link";

import {
  firstThirtyChecklistMarks,
  firstThirtyThresholdTotal,
} from "@/lib/first-thirty/copy";
import {
  FIRST_THIRTY_CAMP_HREF,
  FIRST_THIRTY_DEEDS_HREF,
  FIRST_THIRTY_GREENWOOD_HREF,
  FIRST_THIRTY_JOURNEY_COPY,
  firstThirtyCompactNextLine,
  firstThirtyJourneyPresentation,
  formatFirstThirtyLeafLine,
  isFirstThirtyPathInactiveBelowOpen,
  shouldShowActiveFirstThirty,
  shouldShowGreenwoodOpenAction,
} from "@/lib/first-thirty/presentation";
import { CANOPY_DISPLAY } from "@/lib/site/world-vocabulary";
import type { SafeFirstThirtyProgress } from "@/lib/first-thirty/types";

type FirstThirtyJourneyProps = {
  progress: SafeFirstThirtyProgress | null;
  loading: boolean;
  failed: boolean;
  /** homepage orientation vs fuller outlaw journey */
  surface: "home" | "outlaw";
};

/**
 * Orientation journey for homepage and /outlaw.
 * Trusted GET status only — never milestone celebration replay.
 */
export function FirstThirtyJourney({
  progress,
  loading,
  failed,
  surface,
}: FirstThirtyJourneyProps) {
  const isHome = surface === "home";
  const rootClass = isHome
    ? "ft-journey ft-journey--home"
    : "ft-journey ft-journey--outlaw";

  if (loading) {
    return (
      <section
        className={`${rootClass} ft-journey--loading`}
        aria-labelledby={isHome ? "ft-home-title" : "ft-outlaw-title"}
        aria-busy="true"
      >
        {isHome ? (
          <p className="ft-journey__eyebrow muted">
            {FIRST_THIRTY_JOURNEY_COPY.eyebrow}
          </p>
        ) : null}
        <h2
          id={isHome ? "ft-home-title" : "ft-outlaw-title"}
          className="ft-journey__title"
        >
          {FIRST_THIRTY_JOURNEY_COPY.title}
        </h2>
        <p className="muted ft-journey__loading" aria-live="polite">
          {FIRST_THIRTY_JOURNEY_COPY.loading}
        </p>
      </section>
    );
  }

  if (failed || !progress) {
    if (isHome && !failed) {
      return null;
    }
    return (
      <section
        className={`${rootClass} ft-journey--fallback`}
        aria-labelledby={isHome ? "ft-home-title" : "ft-outlaw-title"}
      >
        {isHome ? (
          <p className="ft-journey__eyebrow muted">
            {FIRST_THIRTY_JOURNEY_COPY.eyebrow}
          </p>
        ) : null}
        <h2
          id={isHome ? "ft-home-title" : "ft-outlaw-title"}
          className="ft-journey__title"
        >
          {FIRST_THIRTY_JOURNEY_COPY.title}
        </h2>
        <p>{FIRST_THIRTY_JOURNEY_COPY.fetchFail}</p>
        <p className="muted">{FIRST_THIRTY_JOURNEY_COPY.fetchFailAside}</p>
        <p className="ft-journey__actions">
          <Link href={FIRST_THIRTY_CAMP_HREF} className="btn-text">
            {FIRST_THIRTY_JOURNEY_COPY.visitCamp}
          </Link>
          <Link href={FIRST_THIRTY_DEEDS_HREF} className="btn-text">
            {FIRST_THIRTY_JOURNEY_COPY.visitDeeds}
          </Link>
        </p>
      </section>
    );
  }

  // Greenwood open: self-explanatory — no NEXT label.
  if (shouldShowGreenwoodOpenAction(progress)) {
    const total = firstThirtyThresholdTotal(progress) || 30;
    const lifetime = Math.max(0, Math.trunc(progress.lifetimeLeaf));
    return (
      <section
        className={`${rootClass} ft-journey--open`}
        aria-labelledby={isHome ? "ft-home-title" : "ft-outlaw-title"}
      >
        {!isHome ? (
          <p className="ft-journey__rule" aria-hidden="true">
            --------------------------------
          </p>
        ) : (
          <p className="ft-journey__eyebrow muted">
            {FIRST_THIRTY_JOURNEY_COPY.eyebrow}
          </p>
        )}
        <h2
          id={isHome ? "ft-home-title" : "ft-outlaw-title"}
          className="ft-journey__title"
        >
          {FIRST_THIRTY_JOURNEY_COPY.openTitle}
        </h2>
        {!isHome ? (
          <p className="ft-journey__leaf">
            {lifetime} / {total} LEAF
          </p>
        ) : null}
        <p>{FIRST_THIRTY_JOURNEY_COPY.openBody}</p>
        <p className="ft-journey__actions">
          <Link href={FIRST_THIRTY_GREENWOOD_HREF} className="btn-text">
            {FIRST_THIRTY_JOURNEY_COPY.walkToGreenwood}
          </Link>
        </p>
        {!isHome ? (
          <p className="ft-journey__rule" aria-hidden="true">
            --------------------------------
          </p>
        ) : null}
      </section>
    );
  }

  if (isFirstThirtyPathInactiveBelowOpen(progress)) {
    return (
      <section
        className={`${rootClass} ft-journey--inactive`}
        aria-labelledby={isHome ? "ft-home-title" : "ft-outlaw-title"}
      >
        {isHome ? (
          <p className="ft-journey__eyebrow muted">
            {FIRST_THIRTY_JOURNEY_COPY.eyebrow}
          </p>
        ) : null}
        <h2
          id={isHome ? "ft-home-title" : "ft-outlaw-title"}
          className="visually-hidden"
        >
          {FIRST_THIRTY_JOURNEY_COPY.title}
        </h2>
        <p>{FIRST_THIRTY_JOURNEY_COPY.pathInactive}</p>
        <p className="ft-journey__actions">
          <Link href={FIRST_THIRTY_CAMP_HREF} className="btn-text">
            {FIRST_THIRTY_JOURNEY_COPY.visitCamp}
          </Link>
          <Link href={FIRST_THIRTY_DEEDS_HREF} className="btn-text">
            {FIRST_THIRTY_JOURNEY_COPY.visitDeeds}
          </Link>
        </p>
      </section>
    );
  }

  if (!shouldShowActiveFirstThirty(progress)) {
    return null;
  }

  return (
    <ActiveJourney progress={progress} surface={surface} rootClass={rootClass} />
  );
}

function ActiveJourney({
  progress,
  surface,
  rootClass,
}: {
  progress: SafeFirstThirtyProgress;
  surface: "home" | "outlaw";
  rootClass: string;
}) {
  const isHome = surface === "home";
  const presentation = firstThirtyJourneyPresentation(progress, surface);
  const compactNext = firstThirtyCompactNextLine(progress);
  const leafLine = formatFirstThirtyLeafLine(progress);
  const total = firstThirtyThresholdTotal(progress) || 30;
  const lifetime = Math.max(0, Math.trunc(progress.lifetimeLeaf));
  const until = Math.max(0, Math.trunc(progress.leafUntilGreenwood));

  const marks = firstThirtyChecklistMarks(progress.milestones);

  const primaryHref =
    presentation.action?.href ?? FIRST_THIRTY_CAMP_HREF;
  const primaryLabel =
    presentation.action?.label ?? FIRST_THIRTY_JOURNEY_COPY.continueJourney;

  const showDesktopNext =
    presentation.nextLabel != null &&
    (presentation.nextDescription.length > 0 || presentation.action);

  return (
    <section
      className={`${rootClass} ft-journey--active`}
      aria-labelledby={isHome ? "ft-home-title" : "ft-outlaw-title"}
    >
      {isHome ? (
        <p className="ft-journey__eyebrow muted">
          {FIRST_THIRTY_JOURNEY_COPY.eyebrow}
        </p>
      ) : (
        <p className="ft-journey__rule" aria-hidden="true">
          --------------------------------
        </p>
      )}

      <h2
        id={isHome ? "ft-home-title" : "ft-outlaw-title"}
        className="ft-journey__title"
      >
        {FIRST_THIRTY_JOURNEY_COPY.title}
      </h2>

      <p className="ft-journey__leaf">{leafLine}</p>

      {/* Journey meaning — principle. One role only. */}
      {presentation.bodyLines.length > 0 ? (
        <div
          className={
            isHome
              ? "ft-journey__principle ft-journey__principle--home"
              : "ft-journey__principle"
          }
        >
          {presentation.bodyLines.map((line) => (
            <p key={line} className={line === presentation.bodyLines[0] ? undefined : "muted"}>
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {presentation.showMilestoneList ? (
        <ul className="ft-journey__list ft-progress__list">
          {marks.map((m) => (
            <li
              key={m.key}
              className="ft-progress__item"
              aria-label={
                m.done ? `${m.label}, complete` : `${m.label}, incomplete`
              }
            >
              <span className="ft-progress__mark" aria-hidden="true">
                {m.done ? "[x]" : "[ ]"}
              </span>
              <span>{m.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Home mobile: compact action line only */}
      {isHome && compactNext ? (
        <p className="ft-journey__compact-next">
          <span className="ft-journey__next-label">
            {FIRST_THIRTY_JOURNEY_COPY.nextLabel}:
          </span>{" "}
          {compactNext}
        </p>
      ) : null}

      {showDesktopNext ? (
        <div
          className={
            isHome
              ? "ft-journey__next ft-journey__next--desktop"
              : "ft-journey__next"
          }
        >
          {presentation.nextLabel ? (
            <p className="ft-journey__next-label">{presentation.nextLabel}</p>
          ) : null}
          {presentation.nextDescription.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {!isHome && until > 0 ? (
            <p className="muted">
              {until} LEAF until the Greenwood opens
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="ft-journey__actions">
        <Link href={primaryHref} className="btn-text">
          {primaryLabel}
        </Link>
      </p>

      {!isHome ? (
        <>
          <p className="ft-journey__rule" aria-hidden="true">
            --------------------------------
          </p>
          <dl className="ft-journey__standing">
            <div>
              <dt>LIFETIME LEAF</dt>
              <dd>{lifetime}</dd>
            </div>
            <div>
              <dt>{CANOPY_DISPLAY.short.toUpperCase()}</dt>
              <dd>
                {progress.greenwoodOpen ? "OPEN" : "NOT YET OPEN"}
              </dd>
            </div>
            <div>
              <dt>THRESHOLD</dt>
              <dd>
                {lifetime} / {total}
              </dd>
            </div>
          </dl>
        </>
      ) : null}
    </section>
  );
}
