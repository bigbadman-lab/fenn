"use client";

import { useEffect, useRef, useState } from "react";

import {
  GatheringFireCard,
  gatheringModelFromSafe,
  GATHERING_FIRE_SECTION_ID,
} from "@/components/greenwood/gathering-fire-card";
import { formatGatheringCountdown } from "@/lib/greenwood/gatherings/countdown";
import type { FireGatheringsSnapshot } from "@/lib/greenwood/gatherings/types";

type Props = {
  status: "loading" | "ready" | "error";
  snapshot: FireGatheringsSnapshot | null;
  actionPending: boolean;
  refresh: () => Promise<void>;
  raiseHand: (gatheringId: string) => Promise<void>;
  lowerHand: (gatheringId: string) => Promise<void>;
};

function useCountdown(
  targetIso: string | null,
  onReached: () => void,
): string {
  const [, setTick] = useState(0);
  const onReachedRef = useRef(onReached);
  const reachedForTarget = useRef<string | null>(null);

  useEffect(() => {
    onReachedRef.current = onReached;
  }, [onReached]);

  useEffect(() => {
    if (!targetIso) {
      reachedForTarget.current = null;
      return;
    }
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [targetIso]);

  const result = !targetIso
    ? { label: "", reached: false }
    : formatGatheringCountdown(targetIso);

  useEffect(() => {
    if (!targetIso || !result.reached) return;
    if (reachedForTarget.current === targetIso) return;
    reachedForTarget.current = targetIso;
    onReachedRef.current();
  }, [targetIso, result.reached]);

  return result.label;
}

/**
 * Living Greenwood 3 — Gathering panel at The Fire.
 * Parent owns the World Pulse; countdown is atmospheric only.
 */
export function GreenwoodFireGathering({
  status,
  snapshot,
  actionPending,
  refresh,
  raiseHand,
  lowerHand,
}: Props) {
  const active = snapshot?.active ?? null;
  const upcoming = snapshot?.upcoming ?? null;
  const focus = active ?? upcoming;

  const countdownTarget =
    focus == null
      ? null
      : focus.resolvedState === "active"
        ? focus.endsAt
        : focus.resolvedState === "scheduled"
          ? focus.startsAt
          : null;

  const countdownLabel = useCountdown(countdownTarget, () => {
    void refresh();
  });

  if (status === "loading" && !snapshot) {
    return (
      <section
        className="greenwood-interior__section greenwood-fire-gathering"
        aria-labelledby={`${GATHERING_FIRE_SECTION_ID}-title`}
        id={GATHERING_FIRE_SECTION_ID}
      >
        <h2
          id={`${GATHERING_FIRE_SECTION_ID}-title`}
          className="greenwood-member__section-title greenwood-member__section-title--gathering"
        >
          GATHERING
        </h2>
        <p className="muted">listening for a call...</p>
      </section>
    );
  }

  if (status === "error" && !snapshot) {
    return (
      <section
        className="greenwood-interior__section greenwood-fire-gathering"
        aria-labelledby={`${GATHERING_FIRE_SECTION_ID}-title`}
        id={GATHERING_FIRE_SECTION_ID}
      >
        <h2
          id={`${GATHERING_FIRE_SECTION_ID}-title`}
          className="greenwood-member__section-title greenwood-member__section-title--gathering"
        >
          GATHERING
        </h2>
        <p className="muted">the call cannot be heard just now.</p>
      </section>
    );
  }

  if (!focus) {
    return (
      <section
        className="greenwood-interior__section greenwood-fire-gathering"
        aria-labelledby={`${GATHERING_FIRE_SECTION_ID}-title`}
        id={GATHERING_FIRE_SECTION_ID}
      >
        <h2
          id={`${GATHERING_FIRE_SECTION_ID}-title`}
          className="greenwood-member__section-title greenwood-member__section-title--gathering"
        >
          GATHERING
        </h2>
        <p>No Gathering has been called.</p>
        <p className="muted">
          Those waiting at the Fire will be here when one begins.
        </p>
      </section>
    );
  }

  return (
    <GatheringFireCard
      gathering={gatheringModelFromSafe(focus)}
      mode="live"
      countdownLabel={countdownLabel || null}
      showActions
      actionPending={actionPending}
      sectionId={GATHERING_FIRE_SECTION_ID}
      onRaise={() => {
        void raiseHand(focus.id);
      }}
      onLower={() => {
        void lowerHand(focus.id);
      }}
    />
  );
}
