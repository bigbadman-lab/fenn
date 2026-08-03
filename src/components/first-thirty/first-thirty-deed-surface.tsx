"use client";

import Link from "next/link";

import { FirstThirtyAcknowledge } from "@/components/first-thirty/first-thirty-acknowledge";
import { FirstThirtyProgressPanel } from "@/components/first-thirty/first-thirty-progress";
import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { useFirstThirtyProgress } from "@/hooks/use-first-thirty";
import {
  FIRST_THIRTY_DEEDS_COPY,
  FIRST_THIRTY_GREENWOOD_HREF,
  firstDeedEventFromTransition,
  firstThirtyEventSessionKey,
  shouldAnnounceFirstThirtyEvent,
  shouldShowActiveFirstThirty,
  shouldShowGreenwoodOpenAction,
} from "@/lib/first-thirty/presentation";
import type {
  FirstThirtyMilestoneEvent,
  SafeFirstThirtyProgress,
} from "@/lib/first-thirty/types";
import { useEffect, useRef, useState } from "react";

type FirstThirtyDeedSurfaceProps = {
  /** board intro vs in-detail orientation */
  placement: "board" | "detail";
  /** Trusted submission status for this deed (detail only). */
  submissionStatus?: "pending" | "approved" | "rejected" | null;
  /** When true, show pre-submit First Thirty note above the proof form. */
  showBeforeSubmitHint?: boolean;
};

/**
 * Restrained First Thirty orientation on Deeds.
 * Uses GET /api/first-thirty only; never invents LEAF.
 */
export function FirstThirtyDeedSurface({
  placement,
  submissionStatus = null,
  showBeforeSubmitHint = false,
}: FirstThirtyDeedSurfaceProps) {
  const { authenticated, registered } = useFennAuth();
  const enabled = authenticated && registered;
  const { progress, refresh } = useFirstThirtyProgress(enabled);
  const prevRef = useRef<SafeFirstThirtyProgress | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const [reveal, setReveal] = useState<{
    event: FirstThirtyMilestoneEvent;
    progress: SafeFirstThirtyProgress;
    eventKey: string;
  } | null>(null);

  useEffect(() => {
    if (!progress) return;
    const event = firstDeedEventFromTransition({
      previous: prevRef.current,
      next: progress,
    });
    prevRef.current = progress;
    if (!event) return;
    const eventKey = firstThirtyEventSessionKey({
      messageId: null,
      event,
      lifetimeLeaf: progress.lifetimeLeaf,
    });
    if (
      !shouldAnnounceFirstThirtyEvent({
        event,
        eventKey,
        seenKeys: seenRef.current,
      })
    ) {
      return;
    }
    seenRef.current.add(eventKey);
    setReveal({ event, progress, eventKey });
  }, [progress]);

  // When submission becomes approved, re-fetch trusted First Thirty.
  const lastStatus = useRef(submissionStatus);
  useEffect(() => {
    if (submissionStatus === "approved" && lastStatus.current !== "approved") {
      void refresh();
    }
    lastStatus.current = submissionStatus;
  }, [submissionStatus, refresh]);

  if (!enabled || !progress) return null;

  if (shouldShowGreenwoodOpenAction(progress) && !reveal) {
    if (placement === "board" && !progress.milestones.firstDeed) {
      // Greenwood open from other path — brief line only.
      return (
        <div className="ft-deed-surface">
          <p className="ft-progress__title">THE GREENWOOD IS OPEN</p>
          <p>
            <Link href={FIRST_THIRTY_GREENWOOD_HREF} className="btn-text">
              [ WALK TO THE GREENWOOD ]
            </Link>
          </p>
        </div>
      );
    }
    if (placement === "detail" && progress.milestones.firstDeed) {
      return (
        <div className="ft-deed-surface">
          <p className="ft-progress__title">THE GREENWOOD IS OPEN</p>
          <p>
            <Link href={FIRST_THIRTY_GREENWOOD_HREF} className="btn-text">
              [ WALK TO THE GREENWOOD ]
            </Link>
          </p>
        </div>
      );
    }
  }

  if (reveal) {
    return (
      <div className="ft-deed-surface">
        <FirstThirtyAcknowledge
          event={reveal.event}
          progress={reveal.progress}
          eventKey={reveal.eventKey}
        />
      </div>
    );
  }

  if (!shouldShowActiveFirstThirty(progress)) {
    if (
      !progress.greenwoodOpen &&
      (progress.terminated || progress.completed) &&
      placement === "detail"
    ) {
      return (
        <p className="muted ft-deed-surface">{FIRST_THIRTY_DEEDS_COPY.pathInactive}</p>
      );
    }
    return null;
  }

  // Active: orientation when first deed is the next step.
  if (progress.nextMilestone !== "first_deed") {
    if (placement === "board") return null;
    return (
      <div className="ft-deed-surface">
        <FirstThirtyProgressPanel progress={progress} variant="compact" />
      </div>
    );
  }

  return (
    <div className="ft-deed-surface">
      <p className="ft-deed-surface__lead">
        {FIRST_THIRTY_DEEDS_COPY.oneDeedRemains}
      </p>
      <p className="muted">{FIRST_THIRTY_DEEDS_COPY.beforeWitness}</p>

      {showBeforeSubmitHint ? (
        <p className="muted ft-deed-surface__hint">
          {FIRST_THIRTY_DEEDS_COPY.beforeSubmit}
        </p>
      ) : null}

      {submissionStatus === "pending" ? (
        <p className="ft-deed-surface__pending" role="status">
          {FIRST_THIRTY_DEEDS_COPY.pendingWitness}
        </p>
      ) : null}

      {placement === "detail" ? (
        <FirstThirtyProgressPanel progress={progress} variant="deeds" />
      ) : null}
    </div>
  );
}
