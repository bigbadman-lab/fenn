"use client";

import type { MouseEvent } from "react";

import { GATHERING_FIRE_SECTION_ID } from "@/components/greenwood/gathering-fire-card";
import type { GatheringAnnouncementStyle } from "@/lib/greenwood/gatherings/announcement-style";
import {
  formatBeginsInLabel,
  formatRemainingDurationLabel,
} from "@/lib/greenwood/gatherings/duration";
import type { GatheringResolvedState } from "@/lib/greenwood/gatherings/types";

export type GatheringCallBannerProps = {
  title?: string;
  resolvedState: Extract<GatheringResolvedState, "scheduled" | "active">;
  startsAt: string;
  endsAt: string;
  announcementStyle: GatheringAnnouncementStyle;
  /** Preview mode ignores time math. */
  mode?: "live" | "preview";
  durationMinutes?: number | null;
  serverNow?: string | null;
};

/**
 * Restrained Greenwood banner for announcementStyle = fire_calling.
 * Member-only surface; never shows hands/attendance.
 */
export function GatheringCallBanner({
  resolvedState,
  startsAt,
  endsAt,
  announcementStyle,
  mode = "live",
  durationMinutes = null,
  serverNow = null,
}: GatheringCallBannerProps) {
  if (announcementStyle !== "fire_calling") return null;
  if (resolvedState !== "active" && resolvedState !== "scheduled" && mode !== "preview") {
    return null;
  }

  const nowMs = serverNow ? Date.parse(serverNow) : Date.now();
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  let heading = "THE FIRE WILL CALL";
  let body = "A Gathering is approaching.";
  let detail = "";
  let cta = "See the Gathering";

  if (mode === "preview") {
    heading = "THE FIRE WILL CALL";
    body = "A Gathering appears as a live call across the Greenwood.";
    detail =
      durationMinutes != null && durationMinutes > 0
        ? `Lasts for ${durationMinutes} minutes once begun.`
        : "Appears while the Gathering is upcoming or live.";
    cta = "See the Gathering";
  } else if (resolvedState === "active") {
    heading = "THE FIRE IS CALLING";
    body = "A Gathering is underway.";
    const remain = Math.max(0, Date.parse(endsAt) - now);
    detail = `${formatRemainingDurationLabel(remain)} remain.`;
    cta = "Go to the Fire";
  } else {
    heading = "THE FIRE WILL CALL";
    body = "A Gathering is approaching.";
    const until = Math.max(0, Date.parse(startsAt) - now);
    detail = `Begins in ${formatBeginsInLabel(until)}.`;
    cta = "See the Gathering";
  }

  function goToFire(event: MouseEvent<HTMLAnchorElement>) {
    if (mode === "preview") {
      event.preventDefault();
      return;
    }
    const target = document.getElementById(GATHERING_FIRE_SECTION_ID);
    if (!target) return;
    event.preventDefault();
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  }

  return (
    <aside
      className="greenwood-gathering-call"
      aria-label={heading}
      data-mode={mode}
    >
      <p className="greenwood-gathering-call__heading">{heading}</p>
      <p className="greenwood-gathering-call__body">{body}</p>
      {detail ? (
        <p className="greenwood-gathering-call__detail muted">{detail}</p>
      ) : null}
      <a
        href={`#${GATHERING_FIRE_SECTION_ID}`}
        className="greenwood-gathering-call__link"
        onClick={goToFire}
      >
        [ {cta} ]
      </a>
    </aside>
  );
}
