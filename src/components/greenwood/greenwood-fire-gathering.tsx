"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useGreenwoodFireGatherings } from "@/hooks/use-greenwood-fire-gatherings";
import { formatGatheringCountdown } from "@/lib/greenwood/gatherings/countdown";
import type { SafeGathering } from "@/lib/greenwood/gatherings/types";

type Props = {
  getAuthHeaders: () => Promise<HeadersInit | null>;
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

function GatheringActions({
  gathering,
  pending,
  onRaise,
  onLower,
}: {
  gathering: SafeGathering;
  pending: boolean;
  onRaise: () => void;
  onLower: () => void;
}) {
  if (gathering.resolvedState !== "active") return null;

  if (gathering.memberHasRaisedHand) {
    return (
      <div className="greenwood-fire-gathering__actions">
        <p className="greenwood-fire-gathering__self-state">
          YOUR HAND IS RAISED
        </p>
        <button
          type="button"
          className="greenwood-fire-gathering__btn"
          disabled={pending || !gathering.canLowerHand}
          onClick={onLower}
        >
          {pending ? "[ LOWERING… ]" : "[ LOWER HAND ]"}
        </button>
      </div>
    );
  }

  return (
    <div className="greenwood-fire-gathering__actions">
      <button
        type="button"
        className="greenwood-fire-gathering__btn"
        disabled={pending || !gathering.canRaiseHand}
        onClick={onRaise}
      >
        {pending ? "[ RAISING… ]" : "[ RAISE HAND ]"}
      </button>
      {!gathering.canRaiseHand && gathering.capacity != null ? (
        <p className="muted">the circle is full.</p>
      ) : null}
    </div>
  );
}

/**
 * Living Greenwood 3 — Gathering panel at The Fire.
 * Countdown is atmospheric only; server state is authority.
 */
export function GreenwoodFireGathering({ getAuthHeaders }: Props) {
  const { status, snapshot, actionPending, refresh, raiseHand, lowerHand } =
    useGreenwoodFireGatherings({ getAuthHeaders });

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
        aria-labelledby="gf-gathering"
      >
        <h2 id="gf-gathering" className="greenwood-member__section-title">
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
        aria-labelledby="gf-gathering"
      >
        <h2 id="gf-gathering" className="greenwood-member__section-title">
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
        aria-labelledby="gf-gathering"
      >
        <h2 id="gf-gathering" className="greenwood-member__section-title">
          GATHERING
        </h2>
        <p>No Gathering has been called.</p>
      </section>
    );
  }

  const isActive = focus.resolvedState === "active";

  return (
    <section
      className="greenwood-interior__section greenwood-fire-gathering"
      aria-labelledby="gf-gathering"
    >
      <h2 id="gf-gathering" className="greenwood-member__section-title">
        {isActive ? "THE GREENWOOD GATHERS" : "NEXT GATHERING"}
      </h2>

      <p className="greenwood-fire-gathering__state">
        {isActive ? "NOW" : "UPCOMING"}
      </p>
      <p className="greenwood-fire-gathering__title">{focus.title}</p>
      {focus.summary ? <p>{focus.summary}</p> : null}

      {countdownLabel ? (
        <p className="greenwood-fire-gathering__countdown muted">
          {isActive
            ? `THE FIRE CLOSES IN ${countdownLabel}`
            : `GATHERING BEGINS IN ${countdownLabel}`}
        </p>
      ) : null}

      {isActive ? (
        <p className="greenwood-fire-gathering__hands">
          {focus.handCount} HAND{focus.handCount === 1 ? "" : "S"} RAISED
        </p>
      ) : null}

      {focus.rewardLeafPreview != null ? (
        <p className="muted">
          remembrance may later bring {focus.rewardLeafPreview} LEAF
        </p>
      ) : null}

      {focus.linkedDeed ? (
        <p className="greenwood-fire-gathering__deed">
          A DEED IS TIED TO THIS GATHERING
          {focus.linkedDeed.slug ? (
            <>
              {" "}
              <Link href={`/deeds/${focus.linkedDeed.slug}`}>
                [ {focus.linkedDeed.title} ]
              </Link>
            </>
          ) : (
            <> — {focus.linkedDeed.title}</>
          )}
        </p>
      ) : null}

      <GatheringActions
        gathering={focus}
        pending={actionPending}
        onRaise={() => {
          void raiseHand(focus.id);
        }}
        onLower={() => {
          void lowerHand(focus.id);
        }}
      />
    </section>
  );
}
